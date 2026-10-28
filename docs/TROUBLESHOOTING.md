# Troubleshooting

## Arduino IDE / uploading

| Problem | Fix |
|---|---|
| *esp32* not in Boards Manager | Add `https://espressif.github.io/arduino-esp32/package_esp32_index.json` under *Settings → Additional boards manager URLs*, then restart the IDE |
| Board package download fails (`connection reset by peer`) | Switch networks (a phone hotspot often works) or turn off your VPN, then retry. Partial downloads resume |
| `bad CPU type in executable` (macOS, Apple Silicon) | Install Rosetta: `softwareupdate --install-rosetta --agree-to-license` |
| `Adafruit_GFX.h: No such file` | Install *Adafruit SSD1306* and accept *Install all* |
| `mbedtls_md5_starts_ret was not declared` | Wrong web-server library. Remove *ESPAsyncWebServer* by lacamera and *AsyncTCP* / *ESPAsyncTCP* by dvarrel; install **ESP Async WebServer** and **Async TCP** by **ESP32Async** |
| No serial port (macOS) or no COM port (Windows) | Use a **data** USB cable, plug in directly (no hub), and install the CP210x or CH340 driver |
| Port disappears during upload | The servo is drawing too much power from USB. Unplug the servo's red wire while uploading |
| `Failed to connect … Wrong boot mode` (ESP32-CAM) | Hold **IO0** on the MB board, tap **RST**, release IO0, then upload |
| `Connecting……` never finishes (ESP32 / S3) | Hold **BOOT** until the upload starts. On the S3, use the **COM/UART** USB-C port |
| Serial Monitor blank | Set 115200 baud, press **EN/RST**, and close other programs using the port |

## Camera

| Problem | Fix |
|---|---|
| `Camera init failed` | Reseat the ribbon cable (latch up, insert, latch down). Use a 5 V 2 A supply |
| `Brownout detector was triggered` | Weak power supply or cable. Use a power bank or charger with a short, thick cable |
| Video slow or stalling | Make sure you are on **ParkingCam**, not a phone hotspot (hotspots relay device-to-device traffic badly). Close other stream viewers |
| A slot shows occupied while empty | Recalibrate with the sheet empty. Check the camera or sheet hasn't moved and there are no shadows. Raise *T_HIGH* in Settings |
| A car isn't detected | Use a darker or more colourful car, lower *Pixel threshold*, and check the box covers the slot (`http://192.168.4.1:81/`) |

## Controller

| Problem | Fix |
|---|---|
| `[WiFi] not connected to "ParkingCam" (network not found)` | The ESP32-CAM is off or restarting |
| `[CAM] OFFLINE` | No ESP-NOW frames: the camera is off, or the controller isn't on ParkingCam yet |
| OLED blank | Swap SDA/SCL, check 3V3/GND. Some modules use address `0x3D` (change `OLED_ADDR`) |
| Gate opens with nothing in front of the IR sensor | Turn the module's potentiometer; if the logic is inverted, set `IR_ACTIVE_LEVEL HIGH` |
| ESP32 restarts when the servo moves | Add a 470–1000 µF capacitor, use a 2 A charger, or give the servo its own 5 V supply |

## Dashboard

| Problem | Fix |
|---|---|
| Both nodes **Offline** | This device isn't on **ParkingCam** |
| Controller offline | Wrong IP: use the one on the OLED. Open `http://<ip>/`; it should say *controller node* |
| Camera online but no video | Another tab or device is watching the stream (one viewer at a time) |
| Phone can't open `http://<laptop-ip>:4173` | Windows: allow Node.js through the firewall (*Private* and *Public*). Check both devices are on ParkingCam |
| `npm install` fails on ParkingCam | ParkingCam has no internet. Run `npm install` on your normal network first |
| Hosted (https) dashboard can't see the boards | Expected: browsers block https → local http. Run it from the laptop with `npm start` |
