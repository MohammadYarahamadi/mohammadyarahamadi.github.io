---
title: "Sous Vide Cooker"
summary: "A DIY sous vide immersion controller with closed-loop temperature control."
role: "Solo builder"
tags: ["embedded", "PID control", "hardware"]
period: "2022"
status: "completed"
hasDemo: true
demoComponent: "SousVideDashboard"
order: 10
---

Built a sous vide immersion controller from scratch: a heating element and
water pump driven by a microcontroller running a PID control loop against a
waterproof temperature probe, with a simple interface for setting and holding
a target temperature.

### Problem

Commercial sous vide circulators are expensive, and I wanted to understand
the control theory behind precise temperature regulation rather than just
buy one.

### Approach

- Temperature sensing via a waterproof digital probe, sampled continuously
- PID loop tuned to minimize overshoot while reaching temperature quickly
- Relay/SSR-driven heating element with a small pump for water circulation
- Basic display/interface for setting a target temperature and monitoring
  progress

### Outcome

A working circulator that holds water temperature within a tight tolerance
of the target — used for actual home cooking, not just a bench test.
