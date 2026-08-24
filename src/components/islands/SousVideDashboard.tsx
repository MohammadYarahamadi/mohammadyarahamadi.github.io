import { useEffect, useRef, useState } from "react";
import "../../styles/islands.css";

const HISTORY_LENGTH = 60;
const START_TEMP = 20;

// Deterministic version of the response the live loop produces, used for the
// paused chart so it shows a representative trace rather than a flat line.
// No Math.random(), so the server-rendered and hydrated markup agree.
function staticTrace(target: number): number[] {
	const out: number[] = [];
	let temp = START_TEMP;
	for (let i = 0; i < HISTORY_LENGTH; i++) {
		temp += (target - temp) * 0.08;
		out.push(temp);
	}
	return out;
}

export default function SousVideDashboard() {
	const [target, setTarget] = useState(57);
	const [running, setRunning] = useState(false);
	const [history, setHistory] = useState<number[]>(() => staticTrace(57));
	const [current, setCurrent] = useState(() => {
		const trace = staticTrace(57);
		return trace[trace.length - 1];
	});

	// The simulated temperature is advanced in a ref rather than inside a
	// state updater: updaters must be pure, and React double-invokes them in
	// StrictMode — which with Math.random() produced mismatched history.
	const tempRef = useRef(START_TEMP);
	// Read inside the loop so changing the setpoint mid-run lets the loop
	// chase it, instead of restarting the effect from START_TEMP.
	const targetRef = useRef(target);

	useEffect(() => {
		targetRef.current = target;
	}, [target]);

	// Start automatically unless the visitor asked for reduced motion, and
	// stop if they turn that preference on while the page is open. Done in an
	// effect (not initial state) so server and client render the same thing.
	useEffect(() => {
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
		if (!mq.matches) setRunning(true);

		const onChange = (event: MediaQueryListEvent) => {
			if (event.matches) setRunning(false);
		};
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);

	// While stopped the chart shows the static trace for the current setpoint.
	useEffect(() => {
		if (running) return;
		const trace = staticTrace(target);
		setHistory(trace);
		setCurrent(trace[trace.length - 1]);
	}, [target, running]);

	useEffect(() => {
		if (!running) return;

		tempRef.current = START_TEMP;
		setHistory(Array(HISTORY_LENGTH).fill(START_TEMP));

		let last = performance.now();
		let frame = 0;

		function tick(now: number) {
			const dt = (now - last) / 1000;
			last = now;

			// Simple approach toward target with a bit of overshoot, like a
			// loosely-tuned PID loop settling on its setpoint.
			const error = targetRef.current - tempRef.current;
			const step = error * Math.min(dt * 0.8, 1);
			const noise = (Math.random() - 0.5) * 0.05;
			const next = tempRef.current + step + noise;

			tempRef.current = next;
			setCurrent(next);
			setHistory((h) => [...h.slice(1), next]);

			frame = requestAnimationFrame(tick);
		}

		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [running]);

	const min = 15;
	const max = 70;
	const points = history
		.map((temp, i) => {
			const x = (i / (HISTORY_LENGTH - 1)) * 100;
			const y = 100 - ((temp - min) / (max - min)) * 100;
			return `${x},${Math.max(0, Math.min(100, y))}`;
		})
		.join(" ");

	return (
		<div className="demo">
			<div className="demo__row" style={{ justifyContent: "space-between" }}>
				<p className="demo__label" style={{ marginBottom: 0 }}>
					{running ? "Live simulation" : "Simulation paused"}
				</p>
				<button
					className="demo__button"
					type="button"
					onClick={() => setRunning((r) => !r)}
				>
					{running ? "Stop" : "Run simulation"}
				</button>
			</div>

			<div className="demo__row" style={{ marginTop: "0.75rem" }}>
				<label
					htmlFor="target-temp"
					style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}
				>
					Target temp
				</label>
				<input
					id="target-temp"
					type="range"
					min={30}
					max={65}
					value={target}
					onChange={(e) => setTarget(Number(e.target.value))}
				/>
				<span className="demo__readout">{target}°C</span>
			</div>

			<svg
				viewBox="0 0 100 100"
				preserveAspectRatio="none"
				style={{ width: "100%", height: "120px", marginTop: "1rem" }}
			>
				<polyline
					points={points}
					fill="none"
					stroke="var(--color-accent)"
					strokeWidth="1.5"
					vectorEffect="non-scaling-stroke"
				/>
			</svg>

			<p className="demo__caption">
				{running
					? `Water temp: ${current.toFixed(1)}°C — simulated PID response to the target set above (not live hardware).`
					: "Showing a representative trace of the loop settling on its setpoint. Press Run to watch it live (simulated — not live hardware)."}
			</p>
		</div>
	);
}
