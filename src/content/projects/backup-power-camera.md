---
title: "Backup-Power Camera"
summary: "An ESP32-CAM wireless camera that keeps recording through power cuts, with battery backup and a cellular (SIM) uplink."
role: "Solo builder"
tags: ["ESP32-CAM", "embedded", "power management", "cellular", "IoT"]
status: "completed"
hasDemo: true
demoComponent: "CameraSystemDiagram"
order: 50
---

A camera that keeps working through power outages, the moment security
cameras are most needed and most likely to go dark.

### How it works

- An ESP32-CAM records and streams the video
- A battery takes over when the mains power fails
- A cellular (SIM) uplink keeps it reachable when the local internet is down
  too

The diagram below shows the switch-over.

[More details to come: parts, runtime and photos.]
