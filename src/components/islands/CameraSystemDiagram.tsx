import { useState } from "react";
import "../../styles/islands.css";

export default function CameraSystemDiagram() {
	const [outage, setOutage] = useState(false);

	const mainsColor = outage ? "#23272c" : "#5eead4";
	const batteryColor = outage ? "#5eead4" : "#23272c";
	const cellularColor = outage ? "#5eead4" : "#23272c";

	return (
		<div className="demo">
			<div className="demo__row" style={{ justifyContent: "space-between" }}>
				<p className="demo__label" style={{ marginBottom: 0 }}>
					{outage ? "Power outage" : "Normal operation"}
				</p>
				<button
					className="demo__button"
					type="button"
					onClick={() => setOutage((o) => !o)}
				>
					Simulate {outage ? "power restored" : "power outage"}
				</button>
			</div>

			<svg viewBox="0 0 100 60" style={{ width: "100%", height: "160px", marginTop: "1rem" }}>
				{/* Mains */}
				<rect x={5} y={10} width={22} height={12} rx={2} fill="none" stroke={mainsColor} strokeWidth={1} />
				<text x={16} y={17} fontSize={4} fill={mainsColor} textAnchor="middle">Mains</text>

				{/* Battery */}
				<rect x={5} y={38} width={22} height={12} rx={2} fill="none" stroke={batteryColor} strokeWidth={1} />
				<text x={16} y={45} fontSize={4} fill={batteryColor} textAnchor="middle">Battery</text>

				{/* Camera unit */}
				<rect x={42} y={24} width={22} height={12} rx={2} fill="none" stroke="#eef1f5" strokeWidth={1} />
				<text x={53} y={31} fontSize={4} fill="#eef1f5" textAnchor="middle">Camera</text>

				{/* Cellular / SIM uplink */}
				<rect x={73} y={24} width={22} height={12} rx={2} fill="none" stroke={cellularColor} strokeWidth={1} />
				<text x={84} y={31} fontSize={3.5} fill={cellularColor} textAnchor="middle">Cellular (SIM)</text>

				{/* Power lines */}
				<line x1={27} y1={16} x2={42} y2={28} stroke={mainsColor} strokeWidth={1} />
				<line x1={27} y1={44} x2={42} y2={32} stroke={batteryColor} strokeWidth={1} />
				{/* Data line */}
				<line x1={64} y1={30} x2={73} y2={30} stroke={cellularColor} strokeWidth={1} />
			</svg>

			<p className="demo__caption">
				{outage
					? "Mains power lost — battery takes over instantly and the cellular uplink keeps the camera reachable even with the local network down."
					: "Running on mains power, uplinked over the local network. Toggle above to see the failover path."}
			</p>
		</div>
	);
}
