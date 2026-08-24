import { useState } from "react";
import "../../styles/islands.css";

const SUBSYSTEMS = [
	{
		id: "tether",
		label: "Tether link",
		x: 10,
		y: 20,
		description:
			"Networked communication link between the surface station and the ROV — carries control commands down and telemetry back up.",
	},
	{
		id: "thrusters",
		label: "Thrusters",
		x: 30,
		y: 70,
		description:
			"Embedded firmware translates control commands into thruster output for navigation.",
	},
	{
		id: "sensors",
		label: "Sensors",
		x: 70,
		y: 30,
		description:
			"Depth, orientation, and camera feed sensors, sampled and reported by the onboard firmware.",
	},
	{
		id: "backend",
		label: "Backend",
		x: 85,
		y: 75,
		description:
			"Surface-side services logging telemetry and exposing vehicle state to the operator interface.",
	},
];

export default function RovModelViewer() {
	const [active, setActive] = useState(SUBSYSTEMS[0].id);
	const activeSystem = SUBSYSTEMS.find((s) => s.id === active)!;

	return (
		<div className="demo">
			<p className="demo__label">System overview — hover a node</p>
			<svg viewBox="0 0 100 100" style={{ width: "100%", height: "180px" }}>
				<line x1={10} y1={20} x2={30} y2={70} stroke="#23272c" strokeWidth={0.5} />
				<line x1={30} y1={70} x2={85} y2={75} stroke="#23272c" strokeWidth={0.5} />
				<line x1={10} y1={20} x2={70} y2={30} stroke="#23272c" strokeWidth={0.5} />
				<line x1={70} y1={30} x2={85} y2={75} stroke="#23272c" strokeWidth={0.5} />

				{SUBSYSTEMS.map((s) => (
					<g
						key={s.id}
						onMouseEnter={() => setActive(s.id)}
						onFocus={() => setActive(s.id)}
						tabIndex={0}
						style={{ cursor: "pointer" }}
					>
						<circle
							cx={s.x}
							cy={s.y}
							r={active === s.id ? 4.5 : 3}
							fill={active === s.id ? "#5eead4" : "#2dd4bf"}
							style={{ transition: "r 0.15s ease" }}
						/>
						<text
							x={s.x}
							y={s.y - 6}
							fontSize={4}
							fill="#9aa3ad"
							textAnchor="middle"
						>
							{s.label}
						</text>
					</g>
				))}
			</svg>

			<p className="demo__caption">{activeSystem.description}</p>
		</div>
	);
}
