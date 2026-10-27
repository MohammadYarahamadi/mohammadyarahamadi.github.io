# Handoff: Mohyar's portfolio website

Paste this whole file into a new chat to continue the work. Written 2026-10-16.

---

## 1. The goal

Mohyar's personal portfolio website (use they/them for Mohyar). Mohyar is an engineer who works
across hardware and software: embedded systems, IoT devices, networking, and the backend and
business software around them. The site shows employers, clients and collaborators what Mohyar
has built, with interactive demos where possible, and makes it easy to get in touch.

Contact shown on the site: **mohyar1380@gmail.com** (Mohyar chose to show it).

## 2. Tech and environment

- **Repo:** `/home/mohyar/projects/website`, git branch `master`, **no remote** (local only).
- **Stack:** Astro 7.2.4 (static output to `dist/`), `@astrojs/react` with React 19 for
  interactive "islands", three.js 0.185 for 3D. Dev tools: `typescript@^5.9` (TypeScript 7 does
  not work with `@astrojs/check`), `@astrojs/check`, gltf-transform and meshoptimizer for the
  3D pipeline.
- **Node:** v24 via nvm. Every shell command must start with
  `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`.
- **Dev server** (from the project CLAUDE.md): `npx astro dev --background`, then
  `astro dev status | logs | stop`.
- **Checks:** `npx astro check` (currently 0 errors, 0 warnings, 27 harmless hints) and
  `npx astro build`.
- **Machine limits:** no sudo, no numpy. Python Pillow is available. ffmpeg/ffprobe are installed.
- **Git rules:** commit only when Mohyar asks. Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- **Never commit** the 89 MB STL or the PSD files. `.gitignore` already has
  `*.STL *.stl *.PSD *.psd tools/out/`.

## 3. Site structure

1. **Homepage `/`** (`src/pages/index.astro`): a **scroll journey**, built from Mohyar's
   design canvas "Portfolio Home" (https://claude.ai/artifact/K7dHWRcBk6zpEpZXBND6oF,
   board `Journey.dc.html`).
   - Each project is a full-screen "world" with its own look:
     - 01 ROV: Ocean;
     - 02 Gamified School: pixel Game;
     - 03 Drilling Simulation: Blueprint;
     - 04 IoT: Terminal;
     - 05 Web & Enterprise: light Dashboard.
   - The page order is intro → worlds → "What I work with" → About timeline → Contact.
   - Markup lives in `src/components/journey/*`, plus `About.astro` and `Contact.astro`.
     Styles are in `src/styles/journey.css`.
   - Scroll state comes from `src/scripts/journey.ts`, which:
     - sets `--p` progress per world;
     - toggles `.on` on the active world and its fixed background layer;
     - updates the nav's chapter pill, colours and progress bar, and the chapter rail.
   - The nav is `mohyar_` with Work, About and Contact. On the homepage it is fixed and
     transparent (`journey` prop on BaseLayout and Nav).
   - Look: dark `#05070A`, cyan `#00E5FF`, Space Grotesk, Inter and JetBrains Mono (plus
     Press Start 2P in the School world). All fonts are self-hosted with `@fontsource`
     (no Google Fonts).
   - Without JS, or with reduced motion, every world shows its final state.
2. **Project popups:** "Read more" buttons in the worlds (`data-open-project="<id>"`) open an accessible modal (`ProjectModal(s).astro`,
   `scripts/modal.ts`, with focus trap). Some modals hold a live demo via `DemoSlot.astro`:
   - `islands/SousVideDashboard.tsx`: a simulated temperature controller. Pressing Run/Stop
     shows water heating to the setpoint under closed-loop PID control.
   - `islands/CameraSystemDiagram.tsx`: an interactive diagram of the camera switching from mains
     power and normal network to battery and a cellular (SIM) uplink during an outage.
3. **ROV page `/projects/rov/`** (`src/pages/projects/rov.astro`): the flagship project gets a
   full page instead of a modal (see §5). The ROV world links to it with "Take the 3D dive".
   `ProjectModals.astro` skips any project that has a `page`.
4. **Shared:**
   - `layouts/BaseLayout.astro` has a `bodyClass` prop and a `head` slot.
   - `scripts/reveal.ts` and `styles/animations.css` handle scroll-reveal.
   - `styles/global.css` holds the theme tokens (currently a plain dark theme).
   - `styles/islands.css` styles the demos.

### Content model

There is one Markdown file per project in `src/content/projects/`. The schema in
`src/content.config.ts` has these fields:

- title, summary, role, tags, order;
- optional `period` and `status` (completed/ongoing), which are left out when unknown;
- optional `hasDemo` plus `demoComponent`, an enum of `"SousVideDashboard" | "CameraSystemDiagram"`;
- optional `page`, the URL of a dedicated page.

Files: `rov.md`, `gamified-school.md`, `drilling-simulation.md`, `web-enterprise.md`,
`backup-power-camera.md`, `sous-vide.md`, `ac-remote.md`.

## 4. The projects

These are Mohyar's choices from 2026-10-27. The one-line descriptions come from Mohyar,
through the design canvas. **No dates are known yet**, and the bodies end with
"[More details to come…]" placeholders.

1. **ROV (flagship hardware):** see §5. Its own 3D dive page.
2. **Gamified School (flagship software):** a learning platform that turns programming into
   quests, with Docker and PostgreSQL simulated inside the app. Full-stack.
3. **Drilling Simulation:** a physical well-drilling simulator built for a company. ESP32 boards
   simulate the rig's control panels as real hardware.
4. **IoT, three builds:**
   - ESP32-CAM backup-power camera (battery and SIM uplink; live diagram demo);
   - sous vide controller (live PID demo);
   - smart AC remote (ESP32).
5. **Web & Enterprise:** company websites (currently Dealfdi), Odoo ERP/CRM services. Earlier,
   Mohyar was the salesperson for websites the team built.

**About:**
- Computer Engineering degree;
- teaches Arduino to kids at a robotics house;
- taught sales and negotiation at college;
- now learning LLM systems.

## 5. The ROV: facts and the dive page

### Real facts (confirmed by Mohyar)

- A tethered underwater vehicle. Size from the CAD model: **716 × 550 × 120 mm**. Tested to
  **30 m**.
- **6 thrusters:**
  - 3 vertical thrusters: two in the middle through holes in the top, one at the rear;
  - 1 sideways thruster inside the tail;
  - 2 angled, ducted thrusters at the front.
- **Front panel:** an IP camera in the middle, with 2 LEDs either side of it, all behind clear
  acrylic (plexiglass) covers. The LEDs switch on automatically in the dark.
- **Control chain, all built by Mohyar:**
  1. A controller connects to a laptop over Bluetooth. (Say "controller", not "PS4
     controller".)
  2. The laptop sends commands as UDP packets over Wi-Fi to a modem buoy.
  3. A tether runs from the buoy to a network switch inside the ROV.
  4. The switch connects to a Raspberry Pi, which decodes the commands.
  5. The Pi sends PWM values over USB serial to an ESP32.
  6. The ESP32 drives the thrusters.

  The switch also connects the IP camera, so the video goes back up to the laptop.
- **Safety:** a leak sensor designed by the team, read by the Raspberry Pi. If it detects a leak,
  the ROV surfaces automatically.
- **Team livery** (from Mohyar's image `~/projects/Rov design.jpg`; Mohyar confirmed the colours):
  - light-blue body `#6ea8dc`, lighter than the accent blue;
  - white `#e8edf1` and blue `#1f7ad1` stripes;
  - black thrusters `#1b1f24`.
- **Real footage:** `~/projects/VID_20261015_225332_127.mp4` (outside the repo).
  - Clips used: 0:12–0:18 as `rov-feed.mp4` and 1:17–1:23 as `rov-deep.mp4`, both in
    `public/media/`, with JPG posters.
  - It shows underwater structures, fish, and the yellow tether.
- **Unconfirmed, ask Mohyar:**
  - the period "2022–2023";
  - the caption "legs of an offshore platform".

### The dive page (finished)

Scrolling dives from 0 to 30 m:

- **Scroll and gauge:**
  - Each section has a `data-depth`, and depth is interpolated between sections.
  - A depth gauge on the side shows the reading, with notes at 5 m ("red light gone") and
    30 m ("max depth").
- **Water and particles:**
  - The water colour goes teal → blue-green → near-black.
  - Light rays fade out by 12 m.
  - Near the surface the particles are bubbles; deeper they become marine snow. The pointer
    nudges them aside.
  - Section changes send a sonar "ping".
- **3D model:**
  - The real model (built from the CAD file) turns with depth.
  - The LEDs switch on, with glows and beam cones.
  - Around 12 m, the camera's view cone appears.
  - All six thrusters move outward in an exploded view; each propeller stays with its
    housing.
- **Sections:** the vehicle, a diagram of the control chain, what Mohyar built, and the
  outcome. The real footage appears as a camera feed and fades in as the background near the
  bottom.
- **Phones:** the 3D sits in a sticky band at the top, 44vh tall, below the nav.
- **Loading and fallbacks:**
  - Reduced motion gets a still image and manual video controls.
  - The 3D is lazy-loaded, so only this page downloads three.js.
  - Until the 3D loads, or if it fails, `public/models/rov-poster.webp` shows instead.

Files:

- `src/scripts/descent.ts`: scroll → depth, gauge, water, particles, pings, videos. Fires the
  `dive:depth` event and lazily imports the scene.
- `src/scripts/descentScene.ts`: the three.js scene, `startScene({stage,status,gauge,depth})`.
  - The camera is keyed by depth, and its fit excludes the strip under the gauge
    (`setViewOffset`).
  - The livery comes from `paintLivery()`, which uses a shader for the stripes.
- `src/styles/descent.css`: the page's own underwater look. **Keep this look in any redesign.**
- `public/models/rov-v2.glb`: 486 KB, about 63k triangles, with named parts: hull,
  thruster_1..6, prop_1..6, led_1/2, camera, hardware.

### 3D pipeline (`tools/`)

1. `build_mesh.py` reads the CAD STL (not in git) and splits it into named parts.
   - It finds each thruster's axis.
   - It pulls out the second front thruster, which was merged into the hull, by mirroring its
     twin.
   - It separates the propellers from their ducts.
   - It tags the camera and LED covers.
2. `build_glb.mjs` simplifies each part to a triangle budget, assigns materials (including a
   transparent acrylic material) and writes `public/models/rov-v2.glb`.

Generated files go to `tools/out/` (git-ignored). Other scripts there are earlier exploration
helpers.

## 6. Git history (latest first)

- `4606e5b`:
  - paints the ROV in the team livery;
  - adds the new transparent poster image;
  - adds `docs/site-brief.md`.
- `3a8b488` adds the ROV dive page:
  - the new model, the footage clips and the `page` schema field;
  - the card badge and link;
  - root-relative nav links;
  - the BaseLayout prop and slot;
  - removal of the old ROV 3D viewer from the modal.
- Earlier commits:
  - the 3D model pipeline;
  - the demo islands and the Run/Stop gate on the sous vide demo;
  - fixes to the modals and the scroll-reveal;
  - the initial site.

The homepage rebuild (2026-10-27) is not committed yet.

## 7. Current state

- **The homepage was rebuilt as the scroll journey** (see §3), following Mohyar's design
  canvas. Mohyar chose it over the three earlier ui-ux-pro-max sample directions.
- The ROV page keeps its underwater look; it now uses the site's self-hosted fonts.
- Not built yet, though they are on the design canvas:
  - the Persian (RTL, Vazirmatn) version and EN/فا switch (board `HomeFA.dc.html`);
  - a themed page per project, plus About, Notes and Contact pages (`StyleTile.dc.html`);
  - GitHub and LinkedIn links (URLs not given yet).

## 8. Next steps

1. **Verify and commit the journey:**
   - run `astro check` and `astro build`;
   - take screenshots at 1440×900 and 390×844, and with reduced motion;
   - commit when Mohyar asks.
2. **Fill in real content** from Mohyar:
   - dates for every project;
   - details for Gamified School, Drilling Simulation, AC remote and Web & Enterprise;
   - the ROV footage caption;
   - GitHub and LinkedIn URLs.
3. **Persian version, then per-project pages,** from the canvas.
4. **Clean up the hint:** add Node types for `Buffer` in `tools/build_glb.mjs`.
5. **Optional:** add a GitHub remote.
6. **Deploy:** to Mohyar's VPS, using Docker Compose behind the existing Caddy
   reverse proxy. No domain has been chosen yet.

## 9. Quality bar (keep for all work)

- Works on phones from 375 px wide, with no horizontal scroll.
- Keyboard accessible with visible focus.
- Text contrast of at least 4.5:1.
- Respects "reduce motion".
- SVG icons only, no emoji.
- Hover transitions of 150–300 ms.
- Heavy things like 3D load lazily, so pages stay fast.
- Copy in plain language.
- Nothing about Mohyar's projects is presented as fact unless Mohyar confirmed it.
