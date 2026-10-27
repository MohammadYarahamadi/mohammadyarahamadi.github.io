/**
 * The ROV's full dive on /projects/: the ROV project page rebuilt in the deep
 * style. Maps scroll through the dive section to 0–30 m and drives the
 * depth gauge, water colour, captions, pings and footage, like descent.ts
 * does on the ROV page. The 3D scene from that page (descentScene.ts) loads
 * the first time the dive comes near the screen; until then, and with
 * reduced motion, the stage shows a still image.
 *
 * Everything sleeps while another project is picked (the section is
 * display: none then).
 */

const MAX = 30;

const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const dive = document.getElementById("dive")!;
const sections = [...dive.querySelectorAll<HTMLElement>(".d-sec")];
const stage = document.getElementById("d-stage")!;
const cap = document.getElementById("d-cap")!;
const statusEl = document.getElementById("d-status")!;
const gauge = document.getElementById("d-gauge")!;
const marker = document.getElementById("d-g-marker")!;
const read = document.getElementById("d-g-read")!;
const deepbg = document.getElementById("d-deepbg") as HTMLVideoElement;
const feed = document.getElementById("d-feed") as HTMLVideoElement;
const rovPicked = document.getElementById("vibe-rov") as HTMLInputElement;

const on = () => rovPicked.checked;
let depth = 0;

// Water colour by depth, as on the ROV page: teal → blue-green → near-black.
const STOPS: [number, number[]][] = [
	[0, [0x2c, 0x78, 0x96]],
	[5, [0x1f, 0x6a, 0x86]],
	[12, [0x14, 0x50, 0x6a]],
	[20, [0x0b, 0x34, 0x49]],
	[30, [0x04, 0x11, 0x1b]],
];
function waterAt(d: number): number[] {
	for (let i = 1; i < STOPS.length; i++) {
		const [d1, c1] = STOPS[i];
		const [d0, c0] = STOPS[i - 1];
		if (d <= d1) {
			const t = (d - d0) / (d1 - d0);
			return c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
		}
	}
	return STOPS[STOPS.length - 1][1];
}

// ---- gauge ticks ----
for (let m = 0; m <= MAX; m++) {
	const y = `${(m / MAX) * 100}%`;
	const t = document.createElement("div");
	t.className = "d-gauge__tick" + (m % 5 === 0 ? " major" : "");
	t.style.top = y;
	gauge.appendChild(t);
	if (m % 5 === 0) {
		const n = document.createElement("div");
		n.className = "d-gauge__num";
		n.style.top = y;
		n.textContent = String(m);
		gauge.appendChild(n);
	}
}

// ---- scroll → depth ----
// Each section's depth is reached when its heading area crosses the middle
// of the screen; depth is interpolated between sections.
let anchors: { y: number; d: number }[] = [];
function measure() {
	if (!on()) return;
	anchors = sections.map((s) => {
		const r = s.getBoundingClientRect();
		return { y: r.top + scrollY + Math.min(r.height, innerHeight) * 0.5, d: Number(s.dataset.depth) };
	});
}
function depthAt(line: number) {
	if (!anchors.length || line <= anchors[0].y) return 0;
	for (let i = 1; i < anchors.length; i++) {
		const a = anchors[i - 1];
		const b = anchors[i];
		if (line <= b.y) return a.d + ((line - a.y) / (b.y - a.y)) * (b.d - a.d);
	}
	return MAX;
}

function ping() {
	if (reduced.matches) return;
	const r = document.createElement("span");
	r.className = "d-ping";
	stage.appendChild(r);
	r.addEventListener("animationend", () => r.remove());
}

let active = -1;
let queued = false;
function update() {
	queued = false;
	if (!on()) return;
	const line = scrollY + innerHeight * 0.5;
	const d = Math.max(0, Math.min(MAX, depthAt(line)));
	depth = d;
	// the gauge appears once the dive itself starts
	stage.classList.toggle("surface", !anchors.length || line < anchors[0].y - innerHeight * 0.4);
	const water = `rgb(${waterAt(d).join(", ")})`;
	// the 3D scene reads its fog colour from :root
	root.style.setProperty("--water", water);
	dive.style.setProperty("--water", water);

	// real dive footage fades in behind the story near the bottom
	const k = Math.max(0, Math.min(1, (d - 25) / 4.5));
	const deep = k * k * (3 - 2 * k) * 0.42;
	dive.style.setProperty("--deep", deep.toFixed(3));
	if (deep > 0.02 && !reduced.matches && !document.hidden) deepbg.play().catch(() => {});
	else if (!deepbg.paused) deepbg.pause();

	const top = `${(d / MAX) * 100}%`;
	marker.style.top = top;
	read.style.top = top;
	read.textContent = `${d.toFixed(1)} m`;

	let idx = 0;
	for (let i = 0; i < anchors.length; i++) if (line >= anchors[i].y - innerHeight * 0.25) idx = i;
	if (idx !== active) {
		if (active !== -1) ping();
		active = idx;
		cap.textContent = sections[idx].dataset.cap ?? "";
	}
	document.dispatchEvent(new CustomEvent("dive:depth", { detail: d }));
}
const queue = () => {
	if (!queued) {
		queued = true;
		requestAnimationFrame(update);
	}
};

addEventListener("scroll", queue, { passive: true });
addEventListener("resize", () => {
	measure();
	queue();
});
document.fonts?.ready.then(() => {
	measure();
	queue();
});
document.addEventListener("deep:change", () => {
	// the mood changes the page's height above and inside the dive
	requestAnimationFrame(() => {
		measure();
		queue();
		if (on()) watch3d();
	});
});

// ---- camera footage: plays only while on screen; manual with reduced motion ----
if (reduced.matches) feed.controls = true;
new IntersectionObserver(
	([e]) => {
		if (e.isIntersecting && !reduced.matches) feed.play().catch(() => {});
		else feed.pause();
	},
	{ threshold: 0.25 },
).observe(feed);

// ---- 3D: loaded the first time the dive comes near the screen ----
let loading = false;
let watcher: IntersectionObserver | null = null;
function load3d() {
	if (loading) return;
	loading = true;
	watcher?.disconnect();
	statusEl.textContent = "Loading 3D model…";
	import("./descentScene")
		.then(({ startScene }) =>
			startScene({
				stage,
				status: statusEl,
				gauge,
				depth: () => depth,
				// the angle the hero's old picture (rov-poster.webp) was rendered from
				start: { az: 0.79, el: 0.62 },
			}),
		)
		// no WebGL or no model: fall back to the still image
		.then(() => stage.classList.toggle("fallback", !stage.classList.contains("live")))
		.catch((err) => {
			console.error(err);
			stage.classList.add("fallback");
			statusEl.textContent = "3D unavailable: still image";
		});
}
function watch3d() {
	if (loading || watcher) return;
	if (reduced.matches) {
		stage.classList.add("fallback");
		statusEl.textContent = "Reduced motion: still image";
		return;
	}
	watcher = new IntersectionObserver(([e]) => e.isIntersecting && load3d(), { rootMargin: "1200px 0px" });
	watcher.observe(dive);
}

measure();
update();
if (on()) watch3d();

export {};
