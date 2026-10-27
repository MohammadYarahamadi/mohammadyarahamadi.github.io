import { useState } from "react";
import "../../styles/islands.css";

// A small Odoo-style CRM pipeline with made-up deals. Cards can be dragged
// between stages (mouse) or moved with the arrow buttons (keyboard, touch),
// and the totals and the target bar follow.

const STAGES = ["New", "Qualified", "Proposal", "Won"] as const;
type Stage = (typeof STAGES)[number];

interface Deal {
	id: number;
	name: string;
	client: string;
	value: number;
	stage: Stage;
}

const START: Deal[] = [
	{ id: 1, name: "Website refresh", client: "Corner Bakery", value: 1800, stage: "New" },
	{ id: 2, name: "Appointment portal", client: "Northside Clinic", value: 4200, stage: "New" },
	{ id: 3, name: "Odoo Inventory", client: "Oak & Pine Furniture", value: 6500, stage: "Qualified" },
	{ id: 4, name: "CRM rollout", client: "Bluefield Logistics", value: 9000, stage: "Qualified" },
	{ id: 5, name: "POS + accounting", client: "Bean There Cafés", value: 7200, stage: "Proposal" },
	{ id: 6, name: "Odoo ERP", client: "Silk Road Textiles", value: 12000, stage: "Won" },
	{ id: 7, name: "Company website", client: "Hale & Co. Law", value: 2400, stage: "Won" },
];

const TARGET = 30000;
const money = (n: number) => "$" + n.toLocaleString("en-US");

export default function SalesPipeline() {
	const [deals, setDeals] = useState(START);
	const [dragId, setDragId] = useState<number | null>(null);
	const [over, setOver] = useState<Stage | null>(null);
	const [status, setStatus] = useState("");

	function move(id: number, stage: Stage) {
		const deal = deals.find((d) => d.id === id);
		if (!deal || deal.stage === stage) return;
		setDeals((all) => all.map((d) => (d.id === id ? { ...d, stage } : d)));
		setStatus(`${deal.client}: moved to ${stage}${stage === "Won" ? `, ${money(deal.value)} won` : ""}.`);
	}

	const won = deals.filter((d) => d.stage === "Won").reduce((s, d) => s + d.value, 0);
	const open = deals.filter((d) => d.stage !== "Won").reduce((s, d) => s + d.value, 0);
	const pct = Math.min(100, Math.round((won / TARGET) * 100));

	return (
		<div className="demo pipe">
			<div className="demo__row" style={{ justifyContent: "space-between" }}>
				<p className="demo__label" style={{ marginBottom: 0 }}>
					CRM · Sales pipeline
				</p>
				<button
					className="demo__button pipe__reset"
					type="button"
					onClick={() => {
						setDeals(START);
						setStatus("Pipeline reset.");
					}}
				>
					Reset
				</button>
			</div>

			<div className="pipe__kpis">
				<div>
					<small>Open pipeline</small>
					<b>{money(open)}</b>
				</div>
				<div>
					<small>Won this month</small>
					<b>{money(won)}</b>
				</div>
				<div className="pipe__target">
					<small>
						Target {money(TARGET)} · {pct}%
					</small>
					<div
						className="pipe__bar"
						role="progressbar"
						aria-label="Won against this month's target"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={pct}
					>
						<i style={{ width: `${pct}%` }} />
					</div>
				</div>
			</div>

			<div className="pipe__board">
				{STAGES.map((stage, si) => {
					const inStage = deals.filter((d) => d.stage === stage);
					return (
						<section
							key={stage}
							className={`pipe__col${over === stage ? " is-over" : ""}${stage === "Won" ? " is-won" : ""}`}
							aria-label={stage}
							onDragOver={(e) => {
								e.preventDefault();
								setOver(stage);
							}}
							onDragLeave={() => setOver((o) => (o === stage ? null : o))}
							onDrop={(e) => {
								e.preventDefault();
								if (dragId !== null) move(dragId, stage);
								setDragId(null);
								setOver(null);
							}}
						>
							<h4>
								{stage} <span>{inStage.length}</span>
							</h4>
							<ul>
								{inStage.map((d) => (
									<li
										key={d.id}
										className={`pipe__card${dragId === d.id ? " is-dragging" : ""}`}
										draggable
										onDragStart={(e) => {
											e.dataTransfer.effectAllowed = "move";
											e.dataTransfer.setData("text/plain", String(d.id));
											setDragId(d.id);
										}}
										onDragEnd={() => {
											setDragId(null);
											setOver(null);
										}}
									>
										<b>{d.client}</b>
										<span>{d.name}</span>
										<span className="pipe__value">{money(d.value)}</span>
										<div className="pipe__moves">
											<button
												type="button"
												disabled={si === 0}
												onClick={() => move(d.id, STAGES[si - 1])}
												aria-label={`Move ${d.client} back to ${STAGES[si - 1] ?? stage}`}
											>
												←
											</button>
											<button
												type="button"
												disabled={si === STAGES.length - 1}
												onClick={() => move(d.id, STAGES[si + 1])}
												aria-label={`Move ${d.client} on to ${STAGES[si + 1] ?? stage}`}
											>
												→
											</button>
										</div>
									</li>
								))}
							</ul>
						</section>
					);
				})}
			</div>

			<p className="demo__caption" aria-live="polite">
				{status || "Drag a deal to another stage, or use its arrows. Made-up deals."}
			</p>
		</div>
	);
}
