# Hardware

## Parts

| Part | Qty | Used for |
|---|---|---|
| ESP32-CAM (AI-Thinker, OV2640 or OV3660 sensor) | 1 | Camera node |
| ESP32-CAM-MB programmer board | 1 | Flashing and powering the ESP32-CAM |
| ESP32 dev board: classic (ESP32-WROOM-32) **or** ESP32-S3 | 1 | Controller node |
| SG90 micro servo | 1 | Entry barrier |
| IR obstacle sensor module | 1 | Detects a car at the entry |
| Buzzer (active or passive) | 1 | Beeps on entry, refusal and gate changes |
| SSD1306 OLED, 0.96″, I²C | 1 | Free-slot count, next slot, node IP |
| LEDs + 150 Ω–1 kΩ resistors | optional | 4 slot LEDs (lit = free), green PASS, red STOP |
| 470–1000 µF capacitor | recommended | Across the servo supply |
| 5 V 2 A power bank or charger | 1–2 | ESP32-CAM (required), controller |

## Controller wiring

`firmware/esp32/esp32.ino` picks the pin set from the board selected in Arduino
(*Tools → Board*), so the same sketch works on both.

| Part | Part pin | Classic ESP32 | ESP32-S3 |
|---|---|---|---|
| Buzzer | + | **GPIO 23** | **GPIO 4** |
| Servo SG90 | signal (orange) | **GPIO 18** | **GPIO 5** |
| IR sensor | OUT | **GPIO 19** | **GPIO 6** |
| OLED | SDA | **GPIO 21** | **GPIO 8** |
| OLED | SCL | **GPIO 22** | **GPIO 9** |
| Slot LED A1 / A2 / A3 / A4 | + | GPIO 25 / 26 / 27 / 14 | GPIO 10 / 11 / 12 / 13 |
| PASS LED (green) | + | GPIO 32 | GPIO 14 |
| STOP LED (red) | + | GPIO 33 | GPIO 21 |

**Power and ground:**

| Part | Pin | Connects to |
|---|---|---|
| Servo | red | **5 V** (VIN on classic, 5V on S3) |
| Servo, IR, OLED, buzzer, LEDs | − / GND | **GND** |
| IR sensor | VCC | **3V3** |
| OLED | VCC | **3V3** |

```
GPIO ──[220 Ω]──►|── GND        LED: long leg towards the GPIO, short leg to GND
```

### Pins that were avoided on purpose

- **Classic ESP32:**
  - GPIO 6–11 (flash chip)
  - GPIO 1 and 3 (USB serial)
  - GPIO 0, 2, 5, 12 and 15 (boot strapping)
- **ESP32-S3:**
  - GPIO 19 and 20 (native USB)
  - GPIO 26–37 (flash/PSRAM)
  - GPIO 0, 3, 45 and 46 (boot strapping)
  - GPIO 43 and 44 (UART0)

### LEDs without resistors

`LED_LOW_DRIVE 1` (the default) sets the LED pins to the ESP32's weakest output strength, so
LEDs wired straight to a GPIO stay at a safe current. Resistors are still the proper solution.

### Buzzer

`BUZZER_TONE 1` (the default) drives the buzzer with a 2.4 kHz tone, which works for both
active and passive buzzers. For an active buzzer, set it to `0` to use plain on/off.

## Camera node

There's nothing to wire except power. Keep the ESP32-CAM on its MB board and power it from a
**5 V 2 A** power bank or charger, not a laptop USB port. An optional calibration button
goes between **IO13** and **GND**.

The camera and controller communicate wirelessly, so they need no wires or shared ground.

## Power

| Board | Supply |
|---|---|
| ESP32-CAM | 5 V 2 A power bank or charger through the MB board (required: weak supplies cause brownouts and stalled video) |
| Controller | USB from a laptop, charger or power bank. The servo takes 5 V from VIN |

If the controller restarts when the servo moves, do one of these:
- add a 470–1000 µF capacitor across the servo's red and brown wires;
- use a 2 A charger;
- power the servo from a separate 5 V supply, with its GND joined to the ESP32's GND.

**Never connect 5 V to a 3V3 pin.**

## Demo lot and camera mount

```
        lamp arm / stand
        ════════╗
                ║
           [ESP32-CAM]      lens pointing straight down, ~30 cm above the sheet
                │
                ▼
   ┌─────────────────────────┐   A4 sheet (landscape), taped down
═══╧═════════════════════════╧═══ table

 ┌────────────────────────────────────┐
 │  ┃ A1  ┃ A2  ┃ A3  ┃ A4  ┃          │  slots ≈ 6 × 10 cm, thick black marker
 │  ┗━━━━━┻━━━━━┻━━━━━┻━━━━━┛          │
 │        ┌──────────┐                 │  REF: blank patch, never parked on
 │        └──────────┘                 │
 └────────────────────────────────────┘
```

- **Paper and cars:** use matte white paper and dark or brightly coloured toy cars.
- **Lighting:** use even room lighting, with no side lamp (it casts long shadows) and no direct
  sunlight.
- **Don't move anything after calibration.** If the camera or the sheet moves, recalibrate.
