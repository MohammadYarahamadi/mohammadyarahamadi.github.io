---
title: "ROV (Remotely Operated Vehicle)"
summary: "A tethered underwater vehicle with six thrusters, a camera and two LEDs, driven with a controller down to 30 m."
role: "Networking, embedded, controls"
tags: ["networking", "embedded", "robotics", "UDP"]
period: "2022–2023"
status: "completed"
page: "/projects/rov/"
order: 20
---

A tethered underwater vehicle driven with a controller. I built the whole
chain, from the controller on the laptop down to the thrusters, and the
network that brings the camera video back up.

### How it works

- **Controller & laptop**: reads the controller over Bluetooth and sends the
  operator's commands as UDP packets over Wi-Fi to a modem buoy
- **Network**: the buoy, the tether and a switch inside the ROV form one IP
  network; commands go down it and the IP camera's video comes back up
- **Raspberry Pi**: receives the UDP commands, decodes them, and sends PWM
  values to the ESP32 over USB serial
- **ESP32**: turns those values into PWM signals for the six thrusters
- **Leak sensor**: our own design, read by the Raspberry Pi; if water gets
  inside the hull, the ROV rises back to the surface by itself

### Outcome

Driven with a controller, with live camera video on the laptop, down to 30 m.
Two LEDs behind clear acrylic covers switch on automatically once it gets dark.
