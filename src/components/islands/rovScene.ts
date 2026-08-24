/**
 * three.js scene for the ROV model.
 *
 * Deliberately not react-three-fiber: this is one static model, and r3f plus
 * drei would add a reconciler and ~50KB gzip for no benefit. Kept out of the
 * React island entirely so it only arrives via dynamic import().
 *
 * Renders on demand — there is no permanent animation loop. A frame is drawn
 * when something actually changes (orbit, resize, camera tween, load), so an
 * idle viewer costs zero GPU work. The one exception is propeller spin, which
 * is opt-in.
 */
import {
	Box3,
	Color,
	DirectionalLight,
	HemisphereLight,
	type Mesh,
	MeshStandardMaterial,
	type Object3D,
	PerspectiveCamera,
	Scene,
	SRGBColorSpace,
	Vector3,
	WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export interface PinSpec {
	id: string;
	anchor: [number, number, number];
	el: HTMLElement;
	/** Mesh name prefixes to highlight when this pin is active. */
	meshes?: string[];
}

export interface SceneOpts {
	canvas: HTMLCanvasElement;
	host: HTMLElement;
	buffer: ArrayBuffer;
	pins: PinSpec[];
	reducedMotion: boolean;
}

export interface RovScene {
	setSpin(on: boolean): void;
	setActive(id: string | null, view?: [number, number, number]): void;
	nudge(dir: -1 | 1): void;
	reset(): void;
	resize(): void;
	pause(): void;
	resume(): void;
	dispose(): void;
}

const SPIN_RATE = 4.5; // rad/s
const TWEEN_MS = 520;
const HOME: [number, number, number] = [0.95, 0.62, 0.95];

export async function createScene(opts: SceneOpts): Promise<RovScene> {
	const { canvas, host, buffer, pins } = opts;
	let reducedMotion = opts.reducedMotion;

	const renderer = new WebGLRenderer({
		canvas,
		antialias: true,
		alpha: false,
		stencil: false,
		depth: true,
		preserveDrawingBuffer: false,
		powerPreference: "low-power",
	});
	// Antialias at a capped ratio is both cheaper and better looking than a
	// full-DPR framebuffer without it.
	const coarse = window.matchMedia("(pointer: coarse)").matches;
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.25 : 1.5));
	renderer.outputColorSpace = SRGBColorSpace;

	const scene = new Scene();
	scene.background = new Color(0x0f1216);

	const camera = new PerspectiveCamera(38, 1, 0.01, 100);
	camera.position.set(...HOME);

	scene.add(new HemisphereLight(0x1b2733, 0x05070a, 2.2));
	const key = new DirectionalLight(0xffffff, 2.4);
	key.position.set(1.4, 1.8, 1.0);
	scene.add(key);
	const rim = new DirectionalLight(0x5eead4, 1.5);
	rim.position.set(-1.2, 0.4, -1.1);
	scene.add(rim);

	const loader = new GLTFLoader();
	loader.setMeshoptDecoder(MeshoptDecoder);
	const gltf = await new Promise<any>((res, rej) =>
		loader.parse(buffer, "", res, rej),
	);
	const model: Object3D = gltf.scene;
	scene.add(model);

	// Give every mesh its own material so a highlight affects only that mesh —
	// the exporter shares two materials across all eleven.
	const meshes: Mesh[] = [];
	const props: { node: Object3D; axis: "x" | "y" | "z"; sign: number }[] = [];
	model.traverse((o: Object3D) => {
		const m = o as Mesh;
		if (m.isMesh) {
			m.material = (m.material as MeshStandardMaterial).clone();
			meshes.push(m);
		}
		const ex = o.userData as { spinAxis?: "x" | "y" | "z"; spinSign?: number };
		if (ex && ex.spinAxis) {
			props.push({ node: o, axis: ex.spinAxis, sign: ex.spinSign ?? 1 });
		}
	});

	const box = new Box3().setFromObject(model);
	const centre = box.getCenter(new Vector3());
	const radius = box.getSize(new Vector3()).length() * 0.5;

	const controls = new OrbitControls(camera, canvas);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.enablePan = false;
	controls.minDistance = radius * 0.8;
	controls.maxDistance = radius * 5;
	controls.target.copy(centre);
	camera.position.copy(centre).add(new Vector3(...HOME).multiplyScalar(radius * 1.6));
	controls.update();

	// ---- render scheduling ------------------------------------------------
	let raf = 0;
	let needsRender = true;
	let spinning = false;
	let paused = false;
	let disposed = false;
	let last = 0;
	let tween: { from: Vector3; to: Vector3; t0: number } | null = null;

	const invalidate = () => {
		needsRender = true;
		schedule();
	};

	function schedule() {
		if (raf || paused || disposed) return;
		raf = requestAnimationFrame(frame);
	}

	const projected = new Vector3();
	function updatePins() {
		// Measure the host, not the canvas: the canvas is display:none until the
		// island switches to its live phase, and would report zero here.
		const w = host.clientWidth;
		const h = host.clientHeight;
		for (const p of pins) {
			projected.set(...p.anchor).project(camera);
			const x = (projected.x * 0.5 + 0.5) * w;
			const y = (-projected.y * 0.5 + 0.5) * h;
			const behind = projected.z > 1;
			// Positioned directly rather than through React state: during spin
			// this runs every frame, and re-rendering React at 60fps for four
			// buttons would be pure waste.
			p.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
			p.el.style.opacity = behind ? "0" : "1";
			p.el.style.pointerEvents = behind ? "none" : "auto";
		}
	}

	function frame(now: number) {
		raf = 0;
		if (disposed) return;
		const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
		last = now;

		let more = false;

		if (spinning) {
			for (const p of props) p.node.rotation[p.axis] += p.sign * SPIN_RATE * dt;
			more = true;
		}

		if (tween) {
			const k = Math.min(1, (now - tween.t0) / TWEEN_MS);
			const e = 1 - Math.pow(1 - k, 3);
			camera.position.lerpVectors(tween.from, tween.to, e);
			if (k >= 1) tween = null;
			else more = true;
		}

		if (controls.update()) more = true;

		if (needsRender || more) {
			needsRender = false;
			renderer.render(scene, camera);
			updatePins();
		}
		if (more) schedule();
	}

	controls.addEventListener("change", invalidate);

	// ---- sizing -----------------------------------------------------------
	function resize() {
		const w = host.clientWidth;
		const h = host.clientHeight;
		if (!w || !h) return; // modal not laid out yet
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		invalidate();
	}
	const ro = new ResizeObserver(resize);
	ro.observe(host);
	resize();

	// ---- context loss -----------------------------------------------------
	const onLost = (e: Event) => {
		e.preventDefault();
		paused = true;
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
		host.dispatchEvent(new CustomEvent("rov:contextlost", { bubbles: true }));
	};
	canvas.addEventListener("webglcontextlost", onLost);

	function flyTo(dir: [number, number, number]) {
		const to = new Vector3(...dir).normalize().multiplyScalar(camera.position.distanceTo(controls.target));
		to.add(controls.target);
		if (reducedMotion) {
			camera.position.copy(to);
			tween = null;
		} else {
			tween = { from: camera.position.clone(), to, t0: performance.now() };
		}
		invalidate();
	}

	invalidate();

	return {
		setSpin(on) {
			spinning = on && !reducedMotion;
			if (spinning) invalidate();
		},
		setActive(id, view) {
			for (const m of meshes) {
				const pin = id ? pins.find((p) => p.id === id) : null;
				const hit = !!pin?.meshes?.some((n) => m.name.startsWith(n));
				const mat = m.material as MeshStandardMaterial;
				mat.emissive.setHex(hit ? 0x134e48 : 0x000000);
			}
			if (view) flyTo(view);
			invalidate();
		},
		nudge(dir) {
			const offset = camera.position.clone().sub(controls.target);
			const a = dir * 0.35;
			const cos = Math.cos(a);
			const sin = Math.sin(a);
			const x = offset.x * cos - offset.z * sin;
			const z = offset.x * sin + offset.z * cos;
			offset.set(x, offset.y, z);
			camera.position.copy(controls.target).add(offset);
			invalidate();
		},
		reset() {
			flyTo(HOME);
		},
		resize,
		pause() {
			paused = true;
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
		},
		resume() {
			paused = false;
			last = 0;
			invalidate();
		},
		dispose() {
			disposed = true;
			paused = true;
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
			ro.disconnect();
			controls.removeEventListener("change", invalidate);
			controls.dispose();
			canvas.removeEventListener("webglcontextlost", onLost);
			scene.traverse((o: Object3D) => {
				const m = o as Mesh;
				if (!m.isMesh) return;
				m.geometry?.dispose();
				const mats = Array.isArray(m.material) ? m.material : [m.material];
				for (const mat of mats) {
					const any = mat as unknown as Record<string, { dispose?: () => void }>;
					for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"]) {
						any[k]?.dispose?.();
					}
					mat.dispose();
				}
			});
			renderer.dispose();
			// Astro never unmounts islands, so without an explicit context loss
			// the GPU allocation would outlive the modal for the page's lifetime.
			renderer.forceContextLoss();
		},
	};
}
