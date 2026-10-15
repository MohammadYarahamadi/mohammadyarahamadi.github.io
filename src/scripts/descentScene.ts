/**
 * three.js scene for the ROV project page, driven by scroll depth.
 *
 * Loaded lazily by descent.ts. Depth (0–30 m) drives the camera path, the
 * daylight, the LEDs switching on, the camera's view cone, the exploded view
 * and the propellers, which turn with scroll rather than on their own.
 * Renders only when the depth changes; there is no permanent loop.
 *
 * Everything model-specific comes from the GLB itself (tools/build_glb.mjs):
 * props carry `spinAxis`/`spinSign` (their pivot nodes are rotated for the
 * angled front pair), and the acrylic covers carry `role`, `base`, `tip` and
 * `radius` so the LEDs and camera can be placed without coordinates here.
 */
import {
	AddEquation,
	Box3,
	BufferAttribute,
	Color,
	ConeGeometry,
	CustomBlending,
	CylinderGeometry,
	CircleGeometry,
	DirectionalLight,
	DoubleSide,
	EdgesGeometry,
	Fog,
	Group,
	HemisphereLight,
	LineBasicMaterial,
	LineSegments,
	MathUtils,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	type Object3D,
	OneFactor,
	PerspectiveCamera,
	PointLight,
	Quaternion,
	Scene,
	SRGBColorSpace,
	SrcAlphaFactor,
	Vector3,
	WebGLRenderer,
	ZeroFactor,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const MODEL_URL = "/models/rov-v2.glb";

export interface SceneOpts {
	stage: HTMLElement;
	status: HTMLElement;
	/** The fixed depth gauge, which covers the stage's right edge. */
	gauge: HTMLElement;
	depth: () => number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const smooth = (a: number, b: number, x: number) => {
	const t = clamp01((x - a) / (b - a));
	return t * t * (3 - 2 * t);
};

// Camera path, keyed by depth: side view at the surface, round to the front
// as the LEDs come on, overhead-ish for the explode, front three-quarter at
// the bottom. Angles in radians; azimuth π/2 looks straight at the front (+x).
const KEYS = [
	{ d: 0, az: 0.25, el: 0.12 },
	{ d: 5, az: 1.0, el: 0.2 },
	{ d: 12, az: 1.32, el: 0.34 },
	{ d: 20, az: 0.72, el: 0.62 },
	{ d: 30, az: 1.12, el: 0.18 },
];
function camKey(d: number) {
	for (let i = 1; i < KEYS.length; i++) {
		const a = KEYS[i - 1];
		const b = KEYS[i];
		if (d <= b.d) {
			const t = smooth(a.d, b.d, d);
			return { az: lerp(a.az, b.az, t), el: lerp(a.el, b.el, t) };
		}
	}
	return KEYS[KEYS.length - 1];
}

const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as const;

// The team's livery: a navy-grey hull with white and blue speed stripes that
// fan out from behind the tail across the top and the slanted sides, and
// black thrusters. Stripe bands are fractions of the fan's outer edge (the
// hull's widest point at the front), measured outward from the centre line.
const LIVERY = {
	hull: 0x6ea8dc, // lighter than the stripe blue
	white: 0xe8edf1,
	blue: 0x1f7ad1,
	thruster: 0x1b1f24,
	hardware: 0x2a3038,
	apexBehind: 0.18, // fan origin, as a fraction of hull length behind the tail
	start: 0.08, // stripes begin this far (fraction of length) from the tail
	bands: [
		[0, 0.17, "white"],
		[0.17, 0.26, "blue"],
		[0.62, 0.72, "white"],
		[0.72, 0.82, "blue"],
	] as const,
};

/** Paint the livery: stripes are computed per pixel from the top-down
 *  position, because the hull has no UVs and its big flat faces are only a
 *  few triangles (vertex colours would smear). Only the top deck and the
 *  sloped sides get stripes; walls and brackets stay plain. */
function paintLivery(nodes: Record<string, Object3D>) {
	const dark = (hex: number, roughness = 0.45) =>
		new MeshStandardMaterial({ color: hex, roughness, metalness: 0.3 });
	for (const [name, node] of Object.entries(nodes)) {
		const mat = name.startsWith("thruster_") || name.startsWith("prop_")
			? dark(LIVERY.thruster)
			: name === "hardware"
				? dark(LIVERY.hardware, 0.6)
				: null;
		if (mat) node.traverse((o) => { if ((o as Mesh).isMesh) (o as Mesh).material = mat; });
	}

	const hull = nodes.hull as Mesh | undefined;
	if (!hull?.isMesh) return;
	const box = new Box3().setFromObject(hull);
	const len = box.max.x - box.min.x;
	const apexX = box.min.x - LIVERY.apexBehind * len;
	const apexZ = (box.min.z + box.max.z) / 2;
	const spread = (box.max.z - apexZ) / (box.max.x - apexX);
	const white = new Color(LIVERY.white);
	const blue = new Color(LIVERY.blue);

	const mat = new MeshStandardMaterial({ color: LIVERY.hull, roughness: 0.5, metalness: 0.15 });
	mat.onBeforeCompile = (shader) => {
		shader.uniforms.uApex = { value: [apexX, apexZ] };
		shader.uniforms.uSpread = { value: spread };
		shader.uniforms.uStart = { value: box.min.x + LIVERY.start * len };
		shader.uniforms.uTopY = { value: box.max.y };
		shader.uniforms.uWhite = { value: white };
		shader.uniforms.uBlue = { value: blue };
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", "#include <common>\nvarying vec3 vLivPos;\nvarying vec3 vLivN;")
			.replace(
				"#include <project_vertex>",
				"#include <project_vertex>\nvLivPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvLivN = normalize(mat3(modelMatrix) * objectNormal);",
			);
		const band = (a: number, b: number) =>
			`(smoothstep(${a.toFixed(3)} - aa, ${a.toFixed(3)} + aa, t) - smoothstep(${b.toFixed(3)} - aa, ${b.toFixed(3)} + aa, t))`;
		const mix = LIVERY.bands
			.map(([a, b, c]) => `col = mix(col, ${c === "white" ? "uWhite" : "uBlue"}, ${band(a, b)});`)
			.join("\n");
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				"#include <common>\nvarying vec3 vLivPos;\nvarying vec3 vLivN;\nuniform vec2 uApex;\nuniform float uSpread;\nuniform float uStart;\nuniform float uTopY;\nuniform vec3 uWhite;\nuniform vec3 uBlue;",
			)
			.replace(
				"#include <color_fragment>",
				`#include <color_fragment>
				vec3 livN = normalize(vLivN);
				// sloped faces and the top deck only: the front thrusters' flat
				// mounting brackets sit lower and stay plain
				bool deck = livN.y < 0.95 || vLivPos.y > uTopY - 0.01;
				if (livN.y > 0.3 && deck && vLivPos.x > uStart) {
					float t = abs(vLivPos.z - uApex.y) / max(vLivPos.x - uApex.x, 1e-4) / uSpread;
					float aa = fwidth(t) * 0.75;
					vec3 col = diffuseColor.rgb;
					${mix}
					diffuseColor.rgb = col;
				}`,
			);
	};
	hull.material = mat;
}

/** A light shaft: an open cone whose vertex colour fades from the lens out. */
function beamMesh(radius: number, length: number, spread: number) {
	const geo = new CylinderGeometry(spread, radius, length, 32, 8, true); // top = far end
	geo.rotateZ(-Math.PI / 2); // axis along +x
	geo.translate(length / 2, 0, 0);
	const pos = geo.attributes.position;
	const col = new Float32Array(pos.count * 3);
	for (let i = 0; i < pos.count; i++) {
		const k = Math.pow(1 - pos.getX(i) / length, 3);
		col[i * 3] = k;
		col[i * 3 + 1] = k * 0.96;
		col[i * 3 + 2] = k * 0.86;
	}
	geo.setAttribute("color", new BufferAttribute(col, 3));
	// Add light to the colour only. The canvas is transparent over the page's
	// water, and plain additive blending would also write alpha there, turning
	// the faint end of the beam into a dark disc.
	return new Mesh(
		geo,
		new MeshBasicMaterial({
			vertexColors: true,
			transparent: true,
			opacity: 0,
			fog: false,
			blending: CustomBlending,
			blendEquation: AddEquation,
			blendSrc: SrcAlphaFactor,
			blendDst: OneFactor,
			blendSrcAlpha: ZeroFactor,
			blendDstAlpha: OneFactor,
			depthWrite: false,
			side: DoubleSide,
		}),
	);
}

export async function startScene({ stage, status, gauge, depth }: SceneOpts) {
	let renderer: WebGLRenderer;
	try {
		renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
	} catch {
		status.textContent = "WebGL unavailable: still image";
		return;
	}
	const coarse = matchMedia("(pointer: coarse)").matches;
	renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.25 : 1.5));
	renderer.outputColorSpace = SRGBColorSpace;
	renderer.setClearColor(0x000000, 0);

	let model: Object3D;
	try {
		await MeshoptDecoder.ready;
		const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(MODEL_URL);
		model = gltf.scene;
	} catch (err) {
		console.error(err);
		renderer.dispose();
		status.textContent = "Model failed to load: still image";
		return;
	}

	const scene = new Scene();
	const camera = new PerspectiveCamera(34, 1, 0.01, 50);
	scene.add(camera);

	const hemi = new HemisphereLight(0xfff3dc, 0x0a1a24, 1.8);
	scene.add(hemi);
	const sun = new DirectionalLight(0xfff1d6, 2.4);
	sun.position.set(0.4, 3, 0.8);
	scene.add(sun);
	const fog = new Fog(0x2c7896, 1, 10);
	scene.fog = fog;

	scene.add(model);
	const box = new Box3().setFromObject(model);
	const centre = box.getCenter(new Vector3());
	const radius = box.getSize(new Vector3()).length() / 2;
	const nodes = Object.fromEntries(model.children.map((n) => [n.name, n]));
	paintLivery(nodes);

	// ---- acrylic covers: clear, drawn after the solids ----
	model.traverse((o) => {
		const m = o as Mesh;
		const mat = m.material as MeshStandardMaterial | undefined;
		if (m.isMesh && mat?.transparent) {
			mat.depthWrite = false;
			m.renderOrder = 2;
		}
	});

	// ---- props: spin about the pivot's local axis ----
	const props: { node: Object3D; local: Vector3; sign: number; baseQ: Quaternion }[] = [];
	for (const n of model.children) {
		const ex = n.userData as { spinAxis?: keyof typeof AXES; spinSign?: number };
		if (!ex.spinAxis) continue;
		props.push({
			node: n,
			local: new Vector3(...AXES[ex.spinAxis]),
			sign: ex.spinSign ?? 1,
			baseQ: n.quaternion.clone(),
		});
	}

	// ---- exploded view ----
	// Vertical thrusters lift straight out of their holes; the rest slide out
	// horizontally, away from the hull's centre. Each prop moves with its own
	// housing so a thruster stays in one piece. Hull and covers stay put.
	const parts: { node: Object3D; base: Vector3; offset: Vector3 }[] = [];
	for (const p of props) {
		const housing = nodes[`thruster_${p.node.name.split("_")[1]}`];
		const ax = p.local.clone().applyQuaternion(p.baseQ);
		let dir: Vector3;
		if (Math.abs(ax.y) > 0.9) dir = new Vector3(0, 1, 0);
		else {
			dir = p.node.position.clone().sub(centre);
			dir.y = 0;
			// the rear sideways thruster sits inside the hull: out the back
			if (Math.abs(ax.z) > 0.9) dir.set(Math.sign(dir.x) || -1, 0, 0);
			dir.normalize();
		}
		const offset = dir.multiplyScalar((dir.y > 0.5 ? 0.24 : 0.3) * radius);
		for (const node of [housing, p.node]) {
			if (node) parts.push({ node, base: node.position.clone(), offset });
		}
	}
	if (nodes.hardware) {
		parts.push({
			node: nodes.hardware,
			base: nodes.hardware.position.clone(),
			offset: new Vector3(0, -0.22 * radius, 0),
		});
	}

	// ---- LEDs and camera, placed from the covers' own data ----
	const leds: { emitter: Mesh<CircleGeometry, MeshBasicMaterial>; glow: PointLight; beam: Mesh<CylinderGeometry, MeshBasicMaterial> }[] = [];
	let frustum: LineSegments<EdgesGeometry, LineBasicMaterial> | null = null;
	for (const n of model.children) {
		const ex = n.userData as {
			role?: "led" | "camera";
			base?: [number, number, number];
			tip?: [number, number, number];
			radius?: number;
		};
		if (!ex.role || !ex.base || !ex.tip || !ex.radius) continue;
		const base = new Vector3(...ex.base);
		const tip = new Vector3(...ex.tip);
		if (ex.role === "led") {
			const emitter = new Mesh(
				new CircleGeometry(ex.radius * 0.72, 32),
				new MeshBasicMaterial({ color: 0x2a2f33 }),
			);
			emitter.position.copy(base).x += 0.0015;
			emitter.rotation.y = Math.PI / 2; // face +x
			const glow = new PointLight(0xfff1dc, 0, radius * 0.6, 1.5);
			glow.position.copy(tip).x += 0.01;
			const beam = beamMesh(ex.radius * 0.8, radius * 0.7, radius * 0.2);
			beam.position.copy(tip);
			scene.add(emitter, glow, beam);
			leds.push({ emitter, glow, beam });
		} else {
			const depthX = tip.x - base.x;
			const body = new Mesh(
				new CylinderGeometry(ex.radius * 0.5, ex.radius * 0.5, depthX * 0.55, 32),
				new MeshStandardMaterial({ color: 0x15181b, roughness: 0.4, metalness: 0.3 }),
			);
			body.rotation.z = Math.PI / 2;
			body.position.x = depthX * 0.38;
			const lens = new Mesh(
				new CircleGeometry(ex.radius * 0.3, 32),
				new MeshStandardMaterial({ color: 0x0a2a3a, roughness: 0.05, metalness: 0.6, emissive: 0x05202c }),
			);
			lens.rotation.y = Math.PI / 2;
			lens.position.x = depthX * 0.66 + 0.0005;
			// view cone: a faint wireframe frustum out of the lens
			const len = radius * 0.45;
			frustum = new LineSegments(
				new EdgesGeometry(
					new ConeGeometry(len * 0.4, len, 4, 1, true).rotateZ(Math.PI / 2).translate(len / 2, 0, 0),
				),
				new LineBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0, depthWrite: false }),
			);
			frustum.position.x = depthX;
			const rig = new Group();
			rig.add(body, lens, frustum);
			rig.position.copy(base);
			scene.add(rig);
		}
	}

	const canvas = renderer.domElement;
	stage.prepend(canvas);

	// The canvas runs under the depth gauge so beams aren't cut off there, but
	// the model is framed in the uncovered part: the projection centre shifts
	// left by the covered width, and the fit uses the uncovered aspect.
	function resize() {
		const w = stage.clientWidth;
		const h = stage.clientHeight;
		if (!w || !h) return;
		renderer.setSize(w, h, false);
		const covered = Math.max(
			0,
			Math.min(w * 0.4, stage.getBoundingClientRect().right - (gauge.getBoundingClientRect().left - 40)),
		);
		camera.aspect = (w - covered) / h;
		camera.setViewOffset(w - covered, h, 0, 0, w, h);
		camera.updateProjectionMatrix();
		invalidate();
	}

	// ---- state from depth ----
	const water = new Color();
	const skyWarm = new Color(0xfff3dc);
	const skyBlue = new Color(0x4a9cbc);
	const skyDeep = new Color(0x0e2b3b);
	const ledOff = new Color(0x2a2f33);
	const ledOn = new Color(0xfff6e6);
	const spinQ = new Quaternion();
	let target = depth();
	let shown = target;
	let raf = 0;

	function apply(d: number) {
		const e = smooth(13, 19, d) * (1 - smooth(24, 28.5, d));
		const { az, el } = camKey(d);
		// Fit the model's bounding sphere (grown by the explode) to whichever of
		// the two fields of view is narrower: a tall, narrow stage clips the
		// sides long before the top and bottom.
		const vfov = MathUtils.degToRad(camera.fov);
		const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
		const dist = (radius * (1 + 0.26 * e) * 0.9) / Math.sin(Math.min(vfov, hfov) / 2);
		camera.position.set(
			centre.x + Math.cos(el) * Math.sin(az) * dist,
			centre.y + Math.sin(el) * dist,
			centre.z + Math.cos(el) * Math.cos(az) * dist,
		);
		camera.lookAt(centre);

		for (const p of parts) p.node.position.copy(p.base).addScaledVector(p.offset, e);
		// props turn with scroll, not on their own: about one turn per 4 m
		for (const p of props) {
			p.node.quaternion.copy(p.baseQ).multiply(spinQ.setFromAxisAngle(p.local, p.sign * d * 1.6));
		}

		// daylight fades with depth; the LEDs take over once it gets dark
		sun.intensity = lerp(2.6, 0.1, clamp01(d / 18));
		hemi.color.copy(skyWarm).lerp(skyBlue, clamp01(d / 8)).lerp(skyDeep, clamp01((d - 8) / 22));
		hemi.intensity = lerp(1.9, 0.5, clamp01(d / 30));
		const on = smooth(3.5, 6.5, d);
		for (const l of leds) {
			l.emitter.material.color.copy(ledOff).lerp(ledOn, on);
			l.glow.intensity = on * 1.4;
			l.beam.material.opacity = on * lerp(0.16, 0.3, clamp01((d - 6) / 20));
		}
		if (frustum) frustum.material.opacity = smooth(8.5, 11, d) * (1 - smooth(14.5, 17, d)) * 0.6;

		// fog matches the page's water colour and thickens with depth
		water.setStyle(getComputedStyle(document.documentElement).getPropertyValue("--water").trim() || "#2c7896");
		fog.color.copy(water);
		fog.near = dist * 0.75;
		fog.far = dist * lerp(4.2, 2.1, d / 30);
	}

	function frame() {
		raf = 0;
		// ease toward the scroll depth so wheel steps don't look jumpy
		shown += (target - shown) * 0.2;
		if (Math.abs(target - shown) < 0.005) shown = target;
		apply(shown);
		renderer.render(scene, camera);
		if (shown !== target) invalidate();
	}
	function invalidate() {
		if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
	}

	document.addEventListener("dive:depth", (e) => {
		target = (e as CustomEvent<number>).detail;
		invalidate();
	});
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) invalidate();
	});
	addEventListener("resize", resize);
	new ResizeObserver(resize).observe(stage);
	canvas.addEventListener("webglcontextlost", (e) => {
		e.preventDefault();
		stage.classList.remove("live");
		status.textContent = "Graphics reset: still image";
	});

	resize();
	frame();
	stage.classList.add("live");
	status.textContent = "";
}
