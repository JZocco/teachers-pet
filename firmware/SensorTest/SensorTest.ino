/*
 * Teacher's Pet — ESP32-C3 BLE Firmware v2.0
 * ENTR 3330 | Group #1 | Kyle Chabot — Solution Design
 *
 * Hardware: Seeed XIAO ESP32C3 + Velostat/Linqstat sensor + 47KΩ pull-down
 * Battery:  150mAh LiPo connected to XIAO's onboard JST battery pads
 * Wiring:   3.3V → Inner copper electrode → Velostat → Outer copper electrode
 *           → GPIO 2 (A0/ADC) + 47KΩ → GND
 *
 * Board setup in Arduino IDE:
 *   1. File > Preferences > Additional Board URLs:
 *      https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
 *   2. Tools > Board > Boards Manager > Install "esp32" by Espressif
 *   3. Tools > Board > "XIAO_ESP32C3"
 *   4. Tools > USB CDC On Boot > "Enabled"
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <esp_sleep.h>

// ─── Pin Config ───────────────────────────────────────────────
const int SENSOR_PIN = 2;   // GPIO 2 = D0 = A0 on XIAO ESP32C3

// ─── Battery Monitoring ──────────────────────────────────────
// Set BATTERY_HW_GAUGE to true if you soldered the two 100KΩ resistors
// from BAT+ to GND with the midpoint connected to D1 (GPIO 3).
const bool  BATTERY_HW_GAUGE       = false;
const int   BATTERY_PIN            = 3;
const float BATT_FULL              = 4.2;
const float BATT_EMPTY             = 3.0;
const float BATT_DIVIDER           = 2.0;
const unsigned long BATT_READ_MS   = 10000;

// ─── Squeeze Detection ───────────────────────────────────────
const int    SQUEEZE_THRESHOLD  = 300;
const int    RELEASE_THRESHOLD  = 150;
const unsigned long DEBOUNCE_MS = 250;
const int    SAMPLE_MS          = 100;   // 10 Hz

// ─── Deep Sleep ──────────────────────────────────────────────
const unsigned long SLEEP_TIMEOUT_MS = 600000;  // 10 min idle
const unsigned long SLEEP_CHECK_US   = 5000000; // Wake every 5 sec
const int           WAKE_CHECK_READS = 5;

// ─── BLE UUIDs ───────────────────────────────────────────────
#define SERVICE_UUID      "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHAR_LIVE_UUID    "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define CHAR_SQUEEZE_UUID "d5f782b0-7236-4e20-8f2a-1e5e3a1c6b4d"
#define CHAR_STATUS_UUID  "8a7f1168-48af-4efb-83b5-0168e2070264"

// ─── Globals ─────────────────────────────────────────────────
BLEServer*         pServer    = NULL;
BLECharacteristic* pLiveChar  = NULL;
BLECharacteristic* pSqChar    = NULL;
BLECharacteristic* pStatChar  = NULL;
bool deviceConnected    = false;
bool oldDeviceConnected = false;

bool          inSqueeze     = false;
unsigned long squeezeStart  = 0;
int           peakPressure  = 0;
unsigned long totalSqueezes = 0;
unsigned long bootTime      = 0;
unsigned long lastActivity  = 0;
unsigned long lastBattRead  = 0;
String        batteryStatus = "OK";
int           batteryPercent = -1;

// ─── BLE Callbacks ───────────────────────────────────────────
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s)    { deviceConnected = true;  lastActivity = millis(); Serial.println("[BLE] Client connected"); }
  void onDisconnect(BLEServer* s) { deviceConnected = false; Serial.println("[BLE] Client disconnected"); }
};

// ─── Battery ─────────────────────────────────────────────────
void readBattery() {
  if (BATTERY_HW_GAUGE) {
    int raw = analogRead(BATTERY_PIN);
    float vMid = raw * 3.3f / 4095.0f;
    float vBat = vMid * BATT_DIVIDER;
    vBat = constrain(vBat, BATT_EMPTY, BATT_FULL);
    batteryPercent = (int)((vBat - BATT_EMPTY) / (BATT_FULL - BATT_EMPTY) * 100.0f);
    batteryStatus  = String(batteryPercent);
  } else {
    batteryStatus  = "OK";
    batteryPercent = -1;
  }
}

// ─── Setup ───────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(SENSOR_PIN, INPUT);
  if (BATTERY_HW_GAUGE) pinMode(BATTERY_PIN, INPUT);

  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
  if (cause == ESP_SLEEP_WAKEUP_TIMER) {
    delay(10);
    int maxR = 0;
    for (int i = 0; i < WAKE_CHECK_READS; i++) { int r = analogRead(SENSOR_PIN); if (r > maxR) maxR = r; delay(20); }
    if (maxR < SQUEEZE_THRESHOLD) { esp_sleep_enable_timer_wakeup(SLEEP_CHECK_US); esp_deep_sleep_start(); }
    Serial.println("[WAKE] Squeeze detected — staying awake.");
  } else {
    Serial.println("[BOOT] Fresh boot.");
  }

  Serial.println("=== Teacher's Pet v2.0 (XIAO ESP32C3) ===");
  Serial.print("Battery monitor: ");
  Serial.println(BATTERY_HW_GAUGE ? "HARDWARE GAUGE on D1 (GPIO 3)" : "SOFTWARE ONLY");

  BLEDevice::init("TeachersPet_01");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  pLiveChar = pService->createCharacteristic(CHAR_LIVE_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  pLiveChar->addDescriptor(new BLE2902());

  pSqChar = pService->createCharacteristic(CHAR_SQUEEZE_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  pSqChar->addDescriptor(new BLE2902());

  pStatChar = pService->createCharacteristic(CHAR_STATUS_UUID, BLECharacteristic::PROPERTY_READ);

  pService->start();
  BLEAdvertising* pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(SERVICE_UUID);
  pAdv->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.println("Advertising as TeachersPet_01");
  bootTime    = millis();
  lastActivity = millis();
}

// ─── Loop ────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // BLE reconnect
  if (!deviceConnected && oldDeviceConnected) { delay(500); pServer->startAdvertising(); oldDeviceConnected = false; }
  if (deviceConnected && !oldDeviceConnected)  { oldDeviceConnected = true; }

  // Read sensor
  int raw = analogRead(SENSOR_PIN);

  // Squeeze state machine
  if (!inSqueeze && raw > SQUEEZE_THRESHOLD) {
    inSqueeze    = true;
    squeezeStart = now;
    peakPressure = raw;
    lastActivity = now;
  } else if (inSqueeze) {
    if (raw > peakPressure) peakPressure = raw;
    if (raw < RELEASE_THRESHOLD && (now - squeezeStart) >= DEBOUNCE_MS) {
      inSqueeze = false;
      totalSqueezes++;
      unsigned long dur = now - squeezeStart;
      String sqData = String(peakPressure) + "," + String(dur) + "," + String(totalSqueezes) + "," + String(now - bootTime);
      if (deviceConnected) { pSqChar->setValue(sqData.c_str()); pSqChar->notify(); }
      Serial.println("Squeeze #" + String(totalSqueezes) + " peak=" + peakPressure + " dur=" + dur + "ms");
    }
  }

  // Live stream
  if (deviceConnected) {
    String live = String(raw) + "," + String(inSqueeze ? 1 : 0) + "," + String(totalSqueezes);
    pLiveChar->setValue(live.c_str()); pLiveChar->notify();
  }

  // Battery & status
  if (now - lastBattRead > BATT_READ_MS) { readBattery(); lastBattRead = now; }
  String upSec = String((now - bootTime) / 1000);
  String status = "up:" + upSec + "s,squeezes:" + String(totalSqueezes) + ",bat:" + batteryStatus;
  pStatChar->setValue(status.c_str());

  // Deep sleep check
  if (!deviceConnected && !inSqueeze && (now - lastActivity) > SLEEP_TIMEOUT_MS) {
    Serial.println("[SLEEP] Entering sleep cycle...");
    esp_sleep_enable_timer_wakeup(SLEEP_CHECK_US);
    esp_deep_sleep_start();
  }

  delay(SAMPLE_MS);
}