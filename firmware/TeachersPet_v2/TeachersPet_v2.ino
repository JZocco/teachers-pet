/*
 * Teacher's Pet — Velostat Sensor Test
 * Upload this first to confirm your sensor wiring is correct
 * before uploading the full BLE firmware.
 *
 * Open Serial Monitor at 115200 baud and squeeze the ball.
 * You should see values rise above 300 when squeezed.
 */

const int SENSOR_PIN  = 2;   // GPIO 2 = D0 on XIAO ESP32C3
const int THRESHOLD   = 300;

void setup() {
  Serial.begin(115200);
  pinMode(SENSOR_PIN, INPUT);
  Serial.println("=== Teacher's Pet — Sensor Test ===");
  Serial.println("Squeeze the ball. Values should rise above 300.");
  Serial.println("---");
}

void loop() {
  int reading = analogRead(SENSOR_PIN);

  if (reading > THRESHOLD) {
    Serial.print("SQUEEZE DETECTED  value: ");
    Serial.println(reading);
  } else {
    Serial.print("Idle: ");
    Serial.println(reading);
  }

  delay(100);  // 10 Hz
}