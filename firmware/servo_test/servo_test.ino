/*
 * Servo test — moves the gate servo once: 0° -> 90° (open) -> 0° (closed).
 * Press EN/RST on the ESP32 to run it again, or type any key + Enter in the
 * Serial Monitor (115200 baud).
 *
 * Wiring (same as the main controller sketch):
 *   servo orange (signal) -> GPIO 18
 *   servo red (+)         -> VIN (5 V from USB)
 *   servo brown (-)       -> GND
 *
 * Board: "ESP32 Dev Module". Library: ESP32Servo.
 */

#include <Arduino.h>
#include <ESP32Servo.h>

static const uint8_t PIN_SERVO = 18;
static const int CLOSED_DEG = 0;
static const int OPEN_DEG = 90;

Servo gate;

void moveOnce() {
  Serial.println("Opening  -> 90 deg");
  gate.write(OPEN_DEG);
  delay(1500);
  Serial.println("Closing  -> 0 deg");
  gate.write(CLOSED_DEG);
  delay(1000);
  Serial.println("Done. Press EN or type a key + Enter to run again.\n");
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Servo test (GPIO 18) ===");

  ESP32PWM::allocateTimer(0);
  gate.setPeriodHertz(50);              // standard 50 Hz servo signal
  gate.attach(PIN_SERVO, 500, 2400);    // SG90 pulse range in microseconds
  gate.write(CLOSED_DEG);
  delay(800);

  moveOnce();
}

void loop() {
  if (Serial.available()) {
    while (Serial.available()) Serial.read();
    moveOnce();
  }
}
