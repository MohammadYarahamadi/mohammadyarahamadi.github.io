import { useCallback, useEffect, useRef, useState } from "react";
import type { PinSpec, RovScene } from "./rovScene";
import "../../styles/islands.css";

const MODEL_URL = "/models/rov-v1.glb";
const POSTER_URL = "/models/rov-poster.webp";
const DISPOSE_DELAY_MS = 30_000;

/** Anchors are in the model's own normalised space (longest dimension = 1). */
const SUBSYSTEMS = [
	{
		id: "tether",
		label: "Tether link",
		anchor: [0.30, 0.16, 0.0] as [number, number, number],
		view: [0.55, 0.95, 0.45] as [number, number, number],
		// No highlight: the tether isn't in the model, and "hardware" is the
		// screws and rails, which would point at the wrong thing.
		meshes: [],
		description:
			"Networked communication link between the surface station and the ROV — carries control commands down and telemetry back up.",
	},
	{
		id: "thrusters",
		label: "Thrusters",
		anchor: [0.104, 0.06, -0.253] as [number, number, number],
		view: [0.35, 0.55, -0.95] as [number, number, number],
		meshes: ["thruster_", "prop_"],
		description:
			"Embedded firmware translates control commands into thruster output for navigation.",
	},
	{
		id: "sensors",
		label: "Sensors",
		anchor: [0.368, 0.09, 0.312] as [number, number, number],
		view: [0.85, 0.5, 0.85] as [number, number, number],
		meshes: ["enclosure"],
		description:
			"Depth, orientation, and camera feed sensors, sampled and reported by the onboard firmware.",
	},
	{
		id: "backend",
		// Deliberately floating clear of the vehicle: the backend runs topside,
		// so there is no geometry on the ROV it could sensibly attach to.
		anchor: [0.30, 0.44, 0.0] as [number, number, number],
		label: "Backend",
		view: [0.45, 1.0, 0.75] as [number, number, number],
		meshes: [],
		description:
			"Surface-side services logging telemetry and exposing vehicle state to the operator interface.",
	},
];

/** Module-level so reopening the modal never refetches the model. */
let modelCache: ArrayBuffer | null = null;

async function fetchModel(onProgress: (pct: number) => void, signal: AbortSignal) {
	if (modelCache) return modelCache;
	const res = await fetch(MODEL_URL, { signal });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const total = Number(res.headers.get("content-length") || 0);
	if (!res.body || !total) {
		modelCache = await res.arrayBuffer();
		return modelCache;
	}
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let got = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		got += value.length;
		// content-length is the compressed size if the server gzips the GLB,
		// while the stream yields decompressed bytes — so cap it.
		onProgress(Math.min(100, Math.round((got / total) * 100)));
	}
	const out = new Uint8Array(got);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.length;
	}
	modelCache = out.buffer;
	return modelCache;
}

function hasWebGL() {
	try {
		const c = document.createElement("canvas");
		const gl = (c.getContext("webgl2") ||
			c.getContext("webgl")) as WebGLRenderingContext | null;
		if (!gl) return false;
		gl.getExtension("WEBGL_lose_context")?.loseContext();
		return true;
	} catch {
		return false;
	}
}

type Phase = "idle" | "loading" | "live" | "error";

export default function RovModelViewer() {
	// Deterministic initial state: Astro server-renders this island, so no
	// matchMedia/navigator/WebGL probing may happen during the first render.
	const [phase, setPhase] = useState<Phase>("idle");
	const [wantsLive, setWantsLive] = useState(false);
	const [visible, setVisible] = useState(false);
	const [webglOk, setWebglOk] = useState(true);
	const [reduced, setReduced] = useState(false);
	const [progress, setProgress] = useState(0);
	const [active, setActive] = useState<string | null>(null);
	const [spin, setSpin] = useState(false);
	const [err, setErr] = useState("");
	// Bumped by Retry so the load effect reruns even though nothing else changed.
	const [attempt, setAttempt] = useState(0);

	const hostRef = useRef<HTMLDivElement>(null);
	const stageRef = useRef<HTMLDivElement>(null);
	const reducedRef = useRef(false);
	const pinRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const sceneRef = useRef<RovScene | null>(null);
	const disposeTimer = useRef<number | undefined>(undefined);

	useEffect(() => {
		setWebglOk(hasWebGL());
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReduced(mq.matches);
		const onChange = (e: MediaQueryListEvent) => {
			setReduced(e.matches);
			if (e.matches) setSpin(false);
		};
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);

	// Visibility drives everything. Because the modal is display:none until
	// opened, an IntersectionObserver on the host catches modal-close and
	// scroll-away alike, with no coupling to modal.ts.
	useEffect(() => {
		const el = hostRef.current;
		if (!el) return;
		const io = new IntersectionObserver(
			([e]) => setVisible(e.isIntersecting && !document.hidden),
			{ threshold: 0.01 },
		);
		io.observe(el);
		const onVis = () => {
			if (document.hidden) setVisible(false);
			else {
				const r = el.getBoundingClientRect();
				setVisible(r.width > 0 && r.height > 0);
			}
		};
		document.addEventListener("visibilitychange", onVis);
		return () => {
			io.disconnect();
			document.removeEventListener("visibilitychange", onVis);
		};
	}, []);

	useEffect(() => {
		if (!wantsLive || !visible) return;
		window.clearTimeout(disposeTimer.current);

		if (sceneRef.current) {
			sceneRef.current.resume();
			sceneRef.current.resize();
			return;
		}

		let cancelled = false;
		const ac = new AbortController();
		const timeout = window.setTimeout(() => ac.abort(), 20_000);

		(async () => {
			try {
				setPhase("loading");
				const [{ createScene }, buffer] = await Promise.all([
					import("./rovScene"),
					fetchModel(setProgress, ac.signal),
				]);
				if (cancelled || !stageRef.current || !hostRef.current) return;

				const pins: PinSpec[] = SUBSYSTEMS.map((s, i) => ({
					id: s.id,
					anchor: s.anchor,
					meshes: s.meshes,
					el: pinRefs.current[i]!,
				})).filter((p) => p.el);

				const sc = await createScene({
					stage: stageRef.current,
					host: hostRef.current,
					buffer,
					pins,
					reducedMotion: reducedRef.current,
				});
				if (cancelled) {
					sc.dispose();
					return;
				}
				sceneRef.current = sc;
				setPhase("live");
			} catch (e) {
				if (cancelled) return;
				setErr(e instanceof Error ? e.message : String(e));
				setPhase("error");
			} finally {
				window.clearTimeout(timeout);
			}
		})();

		return () => {
			cancelled = true;
			ac.abort();
			window.clearTimeout(timeout);
			const sc = sceneRef.current;
			if (!sc) return;
			sc.pause();
			// Hold the context briefly: flicking the modal shut and open again
			// should not pay for a full rebuild. Past this, free the GPU.
			disposeTimer.current = window.setTimeout(() => {
				sc.dispose();
				sceneRef.current = null;
				setPhase("idle");
			}, DISPOSE_DELAY_MS);
		};
	}, [wantsLive, visible, attempt]);

	useEffect(() => {
		sceneRef.current?.setSpin(spin);
	}, [spin, phase]);

	// The scene is built once and reads this flag at creation, so keep it in
	// sync if the visitor changes the OS preference while the page is open.
	useEffect(() => {
		reducedRef.current = reduced;
		sceneRef.current?.setReducedMotion(reduced);
	}, [reduced, phase]);

	// The canvas only leaves display:none when the phase turns live, so re-measure
	// once React has painted that — otherwise the first frame sizes against zero.
	useEffect(() => {
		if (phase !== "live") return;
		const id = requestAnimationFrame(() => sceneRef.current?.resize());
		return () => cancelAnimationFrame(id);
	}, [phase]);

	const onPin = useCallback((id: string) => {
		const next = active === id ? null : id;
		setActive(next);
		const s = SUBSYSTEMS.find((x) => x.id === next);
		sceneRef.current?.setActive(next, s?.view);
	}, [active]);

	const caption = active
		? SUBSYSTEMS.find((s) => s.id === active)!.description
		: "A 56,000-triangle model reduced from the 1.8-million-triangle CAD export. Pick a subsystem to see what I worked on.";

	if (!webglOk) {
		return (
			<div className="demo">
				<p className="demo__label">System overview</p>
				<img src={POSTER_URL} alt="Render of the ROV" width={1000} height={640}
					style={{ width: "100%", height: "auto", borderRadius: 8 }} />
				<p className="demo__caption">
					Your browser doesn't support WebGL, so the interactive 3D model
					can't load. The render above shows the vehicle.
				</p>
			</div>
		);
	}

	return (
		<div className="demo">
			<div className="demo__row" style={{ justifyContent: "space-between" }}>
				<p className="demo__label" style={{ marginBottom: 0 }}>
					{phase === "live" ? "Interactive model — drag to orbit" : "System overview"}
				</p>
				<div className="demo__row" style={{ gap: "0.5rem" }}>
					{phase === "live" && !reduced && (
						<button className="demo__button" type="button"
							onClick={() => setSpin((s) => !s)} aria-pressed={spin}>
							{spin ? "Stop thrusters" : "Spin thrusters"}
						</button>
					)}
					{phase === "idle" && (
						<button className="demo__button" type="button"
							onClick={() => setWantsLive(true)}>
							Load 3D model
						</button>
					)}
				</div>
			</div>

			<div ref={hostRef} className="demo__viewport">
				{phase !== "live" && (
					<img src={POSTER_URL} alt="Render of the ROV" width={1000} height={640}
						className="demo__poster" loading="lazy" />
				)}
				{/* rovScene.ts creates its own <canvas> in here and removes it on
				    dispose. A disposed canvas's WebGL context is force-lost and
				    never comes back, so no canvas is ever reused or shared. */}
				<div ref={stageRef} className="demo__stage" aria-hidden="true"
					style={{ display: phase === "live" ? "block" : "none" }} />

				{/* hidden, not visibility:hidden — modal.ts's focus trap skips
				    elements with no layout, so unloaded pins can't become its
				    last stop and let focus escape the modal. */}
				<div className="demo__pins" role="group" aria-label="ROV subsystems"
					hidden={phase !== "live"}>
					{SUBSYSTEMS.map((s, i) => (
						<button key={s.id} type="button" className="demo__pin"
							ref={(el) => { pinRefs.current[i] = el; }}
							aria-pressed={active === s.id}
							aria-describedby="rov-caption"
							onClick={() => onPin(s.id)}>
							<span className="demo__pin-dot" aria-hidden="true">{i + 1}</span>
							<span className="demo__pin-label">{s.label}</span>
						</button>
					))}
				</div>

				{phase === "loading" && (
					<div className="demo__overlay">
						Loading model… {progress > 0 ? `${progress}%` : ""}
					</div>
				)}
				{phase === "error" && (
					<div className="demo__overlay">
						<span>Couldn't load the model ({err}).</span>
						<button className="demo__button" type="button"
							onClick={() => { setErr(""); setAttempt((a) => a + 1); }}>
							Retry
						</button>
					</div>
				)}
			</div>

			{phase === "live" && (
				<div className="demo__row" style={{ marginTop: "0.6rem", gap: "0.4rem" }}>
					<button className="demo__button demo__button--ghost" type="button"
						onClick={() => sceneRef.current?.nudge(-1)}>Rotate ←</button>
					<button className="demo__button demo__button--ghost" type="button"
						onClick={() => sceneRef.current?.nudge(1)}>Rotate →</button>
					<button className="demo__button demo__button--ghost" type="button"
						onClick={() => { setActive(null); sceneRef.current?.setActive(null); sceneRef.current?.reset(); }}>
						Reset view
					</button>
				</div>
			)}

			<p className="demo__caption" id="rov-caption" aria-live="polite">{caption}</p>
		</div>
	);
}
