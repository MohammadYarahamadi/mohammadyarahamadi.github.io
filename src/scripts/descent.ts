/**
 * ROV project page: maps scroll to a dive from 0 to 30 m.
 *
 * Drives the depth gauge, the water colour, the particles, the section
 * pings and the footage, and broadcasts the depth as a "dive:depth" event
 * for the 3D scene (descentScene.ts), which is loaded lazily on top. All of
 * this works without the 3D scene; without it the stage shows a still image.
 */

const MAX = 30;

const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const sections = [...document.querySelectorAll<HTMLElement>(".sec")];
const stage = document.getElementById("stage")!;
const cap = document.getElementById("cap")!;
const statusEl = document.getElementById("status")!;
const gauge = document.getElementById("gauge")!;
const marker = document.getElementById("g-marker")!;
const read = document.getElementById("g-read")!;
const deepbg = document.getElementById("deepbg") as HTMLVideoElement;
const feed = document.getElementById("feed") as HTMLVideoElement;

let depth = 0;

// The site nav is sticky; the 3D stage sits just below it.
const nav = document.querySelector<HTMLElement>("header");
const setNavHeight = () =>
	root.style.setProperty("--nav-h", `${nav?.offsetHeight ?? 0}px`);
setNavHeight();

// Water colour by depth. Red is absorbed first (mostly gone by ~5 m), so the
// shift runs teal → blue-green → near-black.
const STOPS: [number, string][] = [
	[0, "#2c7896"],
	[5, "#1f6a86"],
	[12, "#14506a"],
	[20, "#0b3449"],
	[30, "#04111b"],
];
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const STOP_RGB = STOPS.map(([d, h]) => [d, hex(h)] as const);
function waterAt(d: number): number[] {
	for (let i = 1; i < STOP_RGB.length; i++) {
		const [d1, c1] = STOP_RGB[i];
		const [d0, c0] = STOP_RGB[i - 1];
		if (d <= d1) {
			const t = (d - d0) / (d1 - d0);
			return c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
		}
	}
	return STOP_RGB[STOP_RGB.length - 1][1];
}

// ---- gauge ticks ----
for (let m = 0; m <= MAX; m++) {
	const y = `${(m / MAX) * 100}%`;
	const t = document.createElement("div");
	t.className = "gauge__tick" + (m % 5 === 0 ? " major" : "");
	t.style.top = y;
	gauge.appendChild(t);
	if (m % 5 === 0) {
		const n = document.createElement("div");
		n.className = "gauge__num";
		n.style.top = y;
		n.textContent = String(m);
		gauge.appendChild(n);
	}
}
const notes = ([[5, "red light gone"], [30, "max depth"]] as const).map(([m, text]) => {
	const n = document.createElement("div");
	n.className = "gauge__note";
	n.style.top = `${(m / MAX) * 100}%`;
	n.textContent = text;
	gauge.appendChild(n);
	return [m, n] as const;
});

// ---- scroll → depth ----
// Each section's labelled depth is reached when its heading area crosses the
// middle of the viewport; depth is interpolated between sections.
let anchors: { y: number; d: number }[] = [];
function measure() {
	anchors = sections.map((s) => {
		const r = s.getBoundingClientRect();
		return { y: r.top + scrollY + Math.min(r.height, innerHeight) * 0.5, d: Number(s.dataset.depth) };
	});
}
function depthAt(line: number) {
	if (line <= anchors[0].y) return anchors[0].d;
	for (let i = 1; i < anchors.length; i++) {
		const a = anchors[i - 1];
		const b = anchors[i];
		if (line <= b.y) return a.d + ((line - a.y) / (b.y - a.y)) * (b.d - a.d);
	}
	return MAX;
}

let active = -1;
let queued = false;

function ping() {
	if (reduced.matches) return;
	const r = document.createElement("span");
	r.className = "ping";
	stage.appendChild(r);
	r.addEventListener("animationend", () => r.remove());
}

function update() {
	queued = false;
	const line = scrollY + innerHeight * 0.5;
	const d = Math.max(0, Math.min(MAX, depthAt(line)));
	depth = d;
	const [r, g, b] = waterAt(d);
	root.style.setProperty("--water", `rgb(${r}, ${g}, ${b})`);
	root.style.setProperty("--rays", Math.max(0, 1 - d / 12).toFixed(3));

	// real dive footage fades in behind everything near the bottom
	const k = Math.max(0, Math.min(1, (d - 25) / 4.5));
	const deep = k * k * (3 - 2 * k) * 0.42;
	root.style.setProperty("--deep", deep.toFixed(3));
	if (deep > 0.02 && !reduced.matches && !document.hidden) deepbg.play().catch(() => {});
	else if (!deepbg.paused) deepbg.pause();

	const top = `${(d / MAX) * 100}%`;
	marker.style.top = top;
	read.style.top = top;
	read.textContent = `${d.toFixed(1)} m`;
	// the readout sits where the notes do; hide a note while it's passing
	for (const [m, n] of notes) n.style.opacity = Math.abs(d - m) < 1.6 ? "0" : "";

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

measure();
update();
addEventListener("scroll", queue, { passive: true });
addEventListener("resize", () => {
	setNavHeight();
	measure();
	queue();
});
document.fonts?.ready.then(() => {
	measure();
	queue();
});

// ---- camera footage: plays only while on screen; manual with reduced motion ----
if (reduced.matches) {
	feed.controls = true;
	deepbg.preload = "metadata";
}
new IntersectionObserver(
	([e]) => {
		if (e.isIntersecting && !reduced.matches) feed.play().catch(() => {});
		else feed.pause();
	},
	{ threshold: 0.25 },
).observe(feed);

document.addEventListener("click", (e) => {
	if ((e.target as HTMLElement).closest("[data-top]")) {
		e.preventDefault();
		scrollTo({ top: 0, behavior: reduced.matches ? "auto" : "smooth" });
	}
});

// ---- particles: bubbles near the surface, marine snow deeper ----
interface Particle {
	bubble: boolean;
	x: number;
	y: number;
	r: number;
	vx: number;
	vy: number;
	a: number;
	ox: number;
	oy: number;
}
const cv = document.getElementById("particles") as HTMLCanvasElement;
const ctx = cv.getContext("2d")!;
const N = 60;
let W = 0;
let H = 0;
const pointer = { x: -999, y: -999 };
function size() {
	const dpr = Math.min(devicePixelRatio || 1, 1.5);
	W = innerWidth;
	H = innerHeight;
	cv.width = W * dpr;
	cv.height = H * dpr;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function spawn(p: Partial<Particle>, anywhere: boolean): Particle {
	p.bubble = Math.random() < Math.max(0, 1 - depth / 9);
	p.x = Math.random() * W;
	p.y = anywhere ? Math.random() * H : p.bubble ? H + 10 : -10;
	p.r = p.bubble ? 1.4 + Math.random() * 3 : 0.6 + Math.random() * 1.3;
	p.vy = p.bubble ? -(18 + Math.random() * 40) : 6 + Math.random() * 14; // px/s
	p.vx = (Math.random() - 0.5) * 8;
	p.a = p.bubble ? 0.35 : 0.3 + Math.random() * 0.4;
	p.ox = 0;
	p.oy = 0;
	return p as Particle;
}
size();
const parts = Array.from({ length: N }, () => spawn({}, true));
let last = 0;
let raf = 0;
function draw(now: number) {
	raf = 0;
	const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
	last = now;
	ctx.clearRect(0, 0, W, H);
	for (const p of parts) {
		// the pointer nudges particles aside, then the offset relaxes back
		const dx = p.x + p.ox - pointer.x;
		const dy = p.y + p.oy - pointer.y;
		const dist2 = dx * dx + dy * dy;
		if (dist2 < 8100) {
			const f = (1 - Math.sqrt(dist2) / 90) * 60 * dt;
			p.ox += (dx || 1) * f * 0.08;
			p.oy += (dy || 1) * f * 0.08;
		}
		p.ox *= 0.96;
		p.oy *= 0.96;
		p.x += (p.vx + Math.sin(now / 1000 + p.r * 3) * (p.bubble ? 10 : 4)) * dt;
		p.y += p.vy * dt;
		if (p.y < -12 || p.y > H + 12 || p.x < -12 || p.x > W + 12) spawn(p, false);
		ctx.beginPath();
		ctx.arc(p.x + p.ox, p.y + p.oy, p.r, 0, Math.PI * 2);
		if (p.bubble) {
			ctx.strokeStyle = `rgba(255,255,255,${p.a})`;
			ctx.lineWidth = 1;
			ctx.stroke();
		} else {
			ctx.fillStyle = `rgba(222,236,240,${p.a})`;
			ctx.fill();
		}
	}
	if (!reduced.matches && !document.hidden) raf = requestAnimationFrame(draw);
}
function startParticles() {
	if (!raf) {
		last = 0;
		raf = requestAnimationFrame(draw);
	}
}
addEventListener("resize", size);
addEventListener(
	"pointermove",
	(e) => {
		pointer.x = e.clientX;
		pointer.y = e.clientY;
	},
	{ passive: true },
);
document.addEventListener("visibilitychange", () => {
	if (!document.hidden && !reduced.matches) startParticles();
});
reduced.addEventListener("change", () => {
	if (!reduced.matches) startParticles();
});
if (reduced.matches) draw(performance.now());
else startParticles();

// ---- 3D: loaded after first paint, only where it will animate ----
if (reduced.matches) {
	statusEl.textContent = "Reduced motion: still image";
} else {
	requestAnimationFrame(() => {
		import("./descentScene")
			.then(({ startScene }) => startScene({ stage, status: statusEl, gauge, depth: () => depth }))
			.catch((err) => {
				console.error(err);
				statusEl.textContent = "3D unavailable: still image";
			});
	});
}
