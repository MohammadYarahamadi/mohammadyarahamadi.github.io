---
title: "Backup-Power Camera System"
summary: "A camera system that stays online during power outages using battery backup and a cellular (SIM) uplink."
role: "Solo builder"
tags: ["embedded", "power management", "cellular", "IoT"]
period: "2023"
status: "completed"
hasDemo: true
demoComponent: "CameraSystemDiagram"
order: 60
---

Built a camera system designed to keep working through power outages — the
exact scenario where security cameras are most needed and most likely to go
dark.

### Problem

Most home/small-site camera systems fail the moment mains power (and often
the local internet/Wi-Fi router) goes down — precisely when they matter
most.

### Approach

- **Battery backup**: a battery stage that seamlessly takes over powering
  the camera and its controller when mains power is lost, with no gap in
  recording
- **Cellular (SIM) uplink**: a SIM-based cellular connection as the primary
  or fallback network path, so the system stays reachable even if the local
  router/internet is also down
- Power-state monitoring so the system can report when it has switched to
  battery, and how much runtime is left

### Outcome

A camera system that keeps recording and stays remotely reachable through a
full local power outage — validated during real outages, not just bench
tests.
