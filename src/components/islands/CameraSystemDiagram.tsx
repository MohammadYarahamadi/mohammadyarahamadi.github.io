import { useState } from "react";
import "../../styles/islands.css";

export default function CameraSystemDiagram() {
	const [outage, setOutage] = useState(false);

	// The page's own colours, so the diagram matches whichever theme it sits
	// in: accent for the live path, a muted line for idle ones. Set through
	// style (not SVG attributes) so var() resolves in every browser.
	const ON = "var(--color-accent)";
	const OFF = "color-mix(in srgb, var(--color-text-muted) 45%, transparent)";
	const TEXT = "var(--color-text)";
	const mainsColor = outage ? OFF : ON;
	const batteryColor = outage ? ON : OFF;
	const cellularColor = outage ? ON : OFF;

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
				<rect x={5} y={10} width={22} height={12} rx={2} strokeWidth={1} style={{ fill: "none", stroke: mainsColor }} />
				<text x={16} y={17} fontSize={4} textAnchor="middle" style={{ fill: mainsColor }}>Mains</text>

				{/* Battery */}
				<rect x={5} y={38} width={22} height={12} rx={2} strokeWidth={1} style={{ fill: "none", stroke: batteryColor }} />
				<text x={16} y={45} fontSize={4} textAnchor="middle" style={{ fill: batteryColor }}>Battery</text>

				{/* Camera unit */}
				<rect x={42} y={24} width={22} height={12} rx={2} strokeWidth={1} style={{ fill: "none", stroke: TEXT }} />
				<text x={53} y={31} fontSize={4} textAnchor="middle" style={{ fill: TEXT }}>Camera</text>

				{/* Cellular / SIM uplink */}
				<rect x={73} y={24} width={22} height={12} rx={2} strokeWidth={1} style={{ fill: "none", stroke: cellularColor }} />
				<text x={84} y={29.2} fontSize={3.5} textAnchor="middle" style={{ fill: cellularColor }}>Cellular</text>
				<text x={84} y={33.4} fontSize={3.5} textAnchor="middle" style={{ fill: cellularColor }}>(SIM)</text>

				{/* Power lines */}
				<line x1={27} y1={16} x2={42} y2={28} strokeWidth={1} style={{ stroke: mainsColor }} />
				<line x1={27} y1={44} x2={42} y2={32} strokeWidth={1} style={{ stroke: batteryColor }} />
				{/* Data line */}
				<line x1={64} y1={30} x2={73} y2={30} strokeWidth={1} style={{ stroke: cellularColor }} />
			</svg>

			<p className="demo__caption">
				{outage
					? "Mains power lost — battery takes over instantly and the cellular uplink keeps the camera reachable even with the local network down."
					: "Running on mains power, uplinked over the local network. Toggle above to see the failover path."}
			</p>
		</div>
	);
}
