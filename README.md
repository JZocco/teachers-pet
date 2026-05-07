# 🐾 Teacher's Pet
**A sensor-embedded stress ball that passively tracks student squeeze patterns and streams live data to a teacher dashboard over Bluetooth.**

> ENTR 3330 — Section #1 | Group #1 | Professor Twohig
>
> Kyle Chabot · Toby Gestetner · Joana Corcelles · Jake Zocco · Han Wang

---

## What is it?

Teachers can't monitor student stress at scale. In a class of 20–25 kids, real-time SEL (Social-Emotional Learning) tracking is nearly impossible during instruction.

Teacher's Pet is our solution: a normal-looking stress ball with electronics inside. Students squeeze it naturally throughout the day. The embedded sensor detects each squeeze, logs the pressure and duration, and transmits the data wirelessly to a teacher's laptop. The teacher sees a live dashboard showing which students are squeezing — and how hard — without disrupting class.

---

## Repo Structure

```
teachers-pet/
│
├── dashboard/
│   └── index.html              # Teacher dashboard (open in Chrome)
│
├── firmware/
│   ├── TeachersPet_v2/
│   │   └── TeachersPet_v2.ino  # Main BLE firmware (XIAO ESP32C3)
│   └── SensorTest/
│       └── SensorTest.ino      # Quick sensor test sketch
│
└── README.md
```

---

## Hardware (~$30/unit)

| Component | Purpose | Cost |
|---|---|---|
| Seeed XIAO ESP32C3 | Microcontroller + BLE 5.0 + battery charger | ~$5 |
| 402025 LiPo Battery (150mAh) | Power source (25×20×4mm) | ~$8 |
| Velostat/Linqstat sheet | Pressure-sensitive sensor | ~$4 |
| Copper tape (conductive adhesive) | Sensor electrodes | ~$7 |
| 47KΩ resistor | Sensor voltage divider | ~$0 |
| 2× 100KΩ resistors | Battery gauge voltage divider | ~$0 |
| 3D-printed sphere (34mm OD) | Electronics housing | ~$2 |
| TOAOB 2" stress ball | Outer shell | ~$2 |
| **Total** | | **~$30** |

---

## Wiring

All soldering is done to the **underside** of the XIAO with USB-C port facing up.

| From | Pin | To | Pin |
|---|---|---|---|
| LiPo red wire | — | XIAO | BAT+ (center-right) |
| LiPo black wire | — | XIAO | BAT– (center-right) |
| Inner copper electrode | center of + | XIAO | 3V3 (left col, 3rd from top) |
| Outer copper electrode | center of + | XIAO | D0 = GPIO 2 (right col, 1st from top) |
| 47KΩ leg 1 | — | Outer electrode junction | — |
| 47KΩ leg 2 | — | XIAO | GND (left col, 2nd from top) |
| 100KΩ R1 leg 1 | — | XIAO | BAT+ (same pad as battery) |
| R1–R2 junction | midpoint | XIAO | D1 = GPIO 3 (right col, 2nd from top) |
| 100KΩ R2 leg 2 | — | XIAO | GND (same pad as 47KΩ) |

> ⚠️ Double-check battery polarity. Red = BAT+, Black = BAT–.

---

## Firmware Setup

1. Download [Arduino IDE 2.x](https://www.arduino.cc/en/software)
2. **File → Preferences** → add board URL:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. **Tools → Board → Boards Manager** → search `esp32` → install by Espressif
4. Select board: **XIAO_ESP32C3**
5. **Tools → USB CDC On Boot → Enabled**

### Upload order
1. Upload `SensorTest.ino` first — open Serial Monitor at 115200 baud and squeeze to confirm values change
2. Open `TeachersPet_v2.ino`. If you wired the battery gauge, change:
   ```cpp
   const bool BATTERY_HW_GAUGE = false;  // change to true
   ```
3. Upload and confirm in Serial Monitor:
   ```
   Advertising as TeachersPet_01
   Battery monitor: HARDWARE GAUGE on D1 (GPIO 3)
   ```

---

## Dashboard

Open `dashboard/index.html` in **Chrome** with Bluetooth enabled.

- **"Connect via Bluetooth"** — pairs with a live prototype
- **"Run demo with 6 students"** — simulated classroom, no hardware needed

**Tabs:**
- **Classroom** — all connected balls, squeeze counts, live activity
- **Live View** — real-time pressure gauge + 30s scrolling timeline + event log
- **Day View** — squeeze counts by class period + session summary

> The Web Bluetooth API only works in Chrome. No server or internet needed — all data is in browser memory.

---

## v1 → v2 Changes

| | v1 | v2 |
|---|---|---|
| Microcontroller | ESP-WROOM-32 dev board | Seeed XIAO ESP32C3 (21×17.5mm) |
| Sensor | FSR402 (single point) | Velostat + shape (~360° coverage) |
| Pull-down resistor | 10KΩ | 47KΩ (more sensitive) |
| Battery | 500mAh EEMB 403048 | 150mAh 402025 (25×20×4mm) |
| Charger | Separate TP4056 module | Built into XIAO |
| Housing | Electronics exposed | 34mm 3D-printed sphere |
| Battery monitoring | None | 0–100% via voltage divider on D1 |
| Cost/unit | ~$74 | ~$30 |

---

## How it works

1. Student squeezes the ball
2. Velostat resistance drops → voltage at GPIO 2 rises
3. ESP32-C3 samples at 10 Hz, detects squeeze events
4. Ball broadcasts `peak, duration, count, timestamp` over BLE GATT notifications
5. Chrome receives data via Web Bluetooth API and renders it live
6. After 10 min idle, board enters deep sleep and wakes every 5s to check sensor

---

## Team

| Name | Role |
|---|---|
| Kyle Chabot | Solution Design / Hardware / Firmware |
| Jake Zocco | Software / Competitive Research |
| Toby Gestetner | Project Manager / Finance |
| Joana Corcelles | Marketing |
| Han Wang | Customer Research |

---

*ENTR 3330 — Entrepreneurship & Innovation | Northeastern University*