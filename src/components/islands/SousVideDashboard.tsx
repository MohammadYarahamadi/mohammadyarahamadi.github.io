import { useEffect, useRef, useState } from "react";
import "../../styles/islands.css";

const HISTORY_LENGTH = 60;

export default function SousVideDashboard() {
	const [target, setTarget] = useState(57);
	const [current, setCurrent] = useState(20);
	const [history, setHistory] = useState<number[]>(() =>
		Array(HISTORY_LENGTH).fill(20),
	);
	// The simulated temperature is advanced in a ref rather than inside a
	// state updater: updaters must be pure, and React double-invokes them in
	// StrictMode — which with Math.random() and a nested setHistory() call
	// produced doubled, mismatched history entries.
	const tempRef = useRef(20);

	useEffect(() => {
		let last = performance.now();
		let frame = 0;

		function tick(now: number) {
			const dt = (now - last) / 1000;
			last = now;

			// Simple approach toward target with a bit of overshoot, like a
			// loosely-tuned PID loop settling on its setpoint.
			const error = target - tempRef.current;
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
	}, [target]);

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
			<p className="demo__label">Live simulation</p>
			<div className="demo__row">
				<label htmlFor="target-temp" style={{ color: "#9aa3ad", fontSize: "0.875rem" }}>
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
					stroke="#5eead4"
					strokeWidth="1.5"
					vectorEffect="non-scaling-stroke"
				/>
			</svg>

			<p className="demo__caption">
				Water temp: {current.toFixed(1)}°C — simulated PID response to the
				target set above (not live hardware).
			</p>
		</div>
	);
}
