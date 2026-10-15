# Portfolio website brief

You are helping with the personal portfolio website of Mohyar, an engineer who works across
hardware and software: embedded systems, IoT devices, networking, and the backend/business
software around them. The site's job is to show what Mohyar has built, with interactive
demos where possible, so visitors (employers, clients, collaborators) quickly understand
what Mohyar can do, and can get in touch.

## What the website is

- A fast, static portfolio site built with Astro 7 and React 19 "islands" (small
  interactive components that load only when needed), plus three.js for 3D.
- Project content lives in Markdown files (one per project) with a typed schema: title,
  summary, role, tags, period, status (completed/ongoing), optional live demo, optional
  dedicated page, display order.
- Planned hosting: a VPS running Docker Compose behind an existing Caddy reverse proxy
  (domain not chosen yet).
- Quality bar: works well on phones, keyboard accessible, readable contrast, respects
  "reduce motion" settings, and keeps heavy things (like 3D) lazy so pages load fast.
  The ROV page ships about 3 KB of its own JavaScript; the 3D library only downloads on
  that page.

## Structure

1. Homepage (single page): sticky nav (About, Projects, Contact), hero ("I build embedded
   systems, IoT devices, and the software behind them."), About, Projects grid, Contact
   (email: mohyar1380@gmail.com), footer.
2. Project cards open a detail popup (accessible modal with focus trap). Some popups
   include a live demo.
3. The ROV project has its own full page, /projects/rov/, instead of a popup (see below).

## Interactive demos

- **Sous vide dashboard:** a simulated temperature-control panel with Run/Stop showing the
  water temperature rising to the setpoint under closed-loop (PID-style) control.
- **Backup-power camera diagram:** an interactive diagram showing how the camera system
  switches from mains power and normal network to battery and cellular (SIM) uplink
  during an outage.
- **ROV "dive" page:** described below.

## The projects

### 1. ROV (Remotely Operated Vehicle): fully real details, the flagship project

- A tethered underwater vehicle with 6 thrusters (3 vertical through holes in the
  top of the hull, 1 sideways thruster in the tail, 2 angled ducted thrusters at the
  front), an IP camera in the middle of the front panel, and 2 LEDs either side of it.
  The camera and LEDs sit behind clear acrylic covers. The LEDs switch on
  automatically when it gets dark.
- Size from the CAD model: 716 × 550 × 120 mm. Tested down to 30 m.
- Control chain, all built by Mohyar: a controller connects to a laptop over
  Bluetooth; the laptop sends commands as UDP packets over Wi-Fi to a modem buoy; the
  buoy connects through a tether to a network switch inside the ROV; the switch feeds
  a Raspberry Pi, which decodes the commands and sends PWM values over USB serial to
  an ESP32, which drives the thrusters. The same network carries the IP camera's video
  back up to the laptop.
- Safety: a leak sensor of the team's own design, read by the Raspberry Pi. If water
  gets inside the hull, the ROV automatically rises back to the surface.
- Real footage exists: the ROV's camera filmed the legs of an offshore platform with
  schools of fish and the yellow tether in view.
- The website's ROV page is a scroll story: scrolling "dives" from the surface to
  30 m. A depth gauge tracks depth, the water darkens, bubbles turn into marine snow,
  and the real 3D model (built from the CAD file) turns, its LEDs switch on, the
  camera's view cone appears, and all six thrusters move outward in an exploded view.
  Sections cover the vehicle, a diagram of the control chain, what Mohyar built
  (controller and laptop, network, Raspberry Pi, ESP32, leak sensor), and the
  outcome, with the real footage shown as a camera feed and as a background near the
  bottom.
- Period shown as 2022–2023 (**not yet confirmed**; ask the owner).

### 2. Sous vide cooker

A DIY immersion controller with closed-loop temperature control (embedded, PID control,
hardware). Has a live demo. Period shown: 2022.

### 3. Backup-power camera system

A camera that stays online during power outages using battery backup and a cellular (SIM)
uplink (embedded, power management, cellular, IoT). Has a live demo. Period shown: 2023.

### 4. ERP systems

Current, ongoing work building and integrating ERP software (backend, systems
integration). Period: 2025–present.

### 5. Assorted IoT projects

Smaller builds covering sensors, connectivity and small automations. Period shown:
2021–2023.

### 6. Industrial drilling teaching program

IoT and software for a teaching program that simulates industrial drilling operations.
Period shown: 2023.

### 7. Website sales

Sold custom website builds to small-business customers as part of a small team (sales,
client relationships). Period shown: 2021–2022.

> **Important:** for projects 2–7, the one-line summaries reflect what the owner said, but
> the longer descriptions, dates and details on the site are placeholders written without
> the owner's input. Do not present them as facts; ask the owner for real details. Only the
> ROV's details are confirmed.

## About Mohyar (site copy)

Moves between hardware and software: wiring up sensors and microcontrollers, writing the
firmware and backend services that talk to them, and getting the networking right in
between. Has also sold websites to small businesses as part of a small team, which shaped
how they think about building things people need. Currently working on ERP systems.

Skills shown: ESP32, Raspberry Pi, PID control, UDP networking, IoT, backend services, ERP.

## Current state and next step

The site works today with a plain dark theme. The ROV page is finished and has its own
underwater look. The homepage is about to be redesigned from scratch; three directions
are being compared:

- **(a) Robotics:** light slate background, blue, ROV safety-orange accent, Outfit + Work
  Sans, bento-grid projects.
- **(b) Swiss minimal:** off-white, near-black, one blue accent, Archivo + Space Grotesk,
  numbered project rows.
- **(c) Dark technical:** dark slate, green accent, JetBrains Mono + IBM Plex Sans,
  terminal-style details.

Whatever direction is chosen must keep the ROV page's underwater look, the live demos,
accessibility, mobile support and the fast loading described above.
