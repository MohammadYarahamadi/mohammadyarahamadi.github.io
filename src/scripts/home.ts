/**
 * Homepage behaviour, all optional (the page works without it):
 * - the ROV camera footage plays only while on screen, and never on its own
 *   with reduced motion (it gets controls instead);
 * - the "Copy" button next to the email address.
 */

const reduced = matchMedia("(prefers-reduced-motion: reduce)");

for (const video of document.querySelectorAll<HTMLVideoElement>("[data-feed]")) {
	if (reduced.matches) {
		video.controls = true;
		video.preload = "metadata";
		continue;
	}
	new IntersectionObserver(
		([e]) => {
			if (e.isIntersecting && !document.hidden) video.play().catch(() => {});
			else video.pause();
		},
		{ threshold: 0.3 },
	).observe(video);
}

const status = document.querySelector<HTMLElement>("[data-copy-status]");
for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
	const label = btn.querySelector<HTMLElement>("[data-copy-label]")!;
	let timer = 0;
	btn.addEventListener("click", async () => {
		let msg = "Copied";
		try {
			await navigator.clipboard.writeText(btn.dataset.copy!);
		} catch {
			msg = "Press Ctrl+C";
			// no clipboard access: select the address so it can be copied by hand
			const addr = btn.parentElement?.querySelector("a");
			if (addr) getSelection()?.selectAllChildren(addr);
		}
		label.textContent = msg;
		if (status) status.textContent = msg === "Copied" ? "Email address copied" : "Address selected; press Ctrl+C to copy";
		clearTimeout(timer);
		timer = window.setTimeout(() => (label.textContent = "Copy"), 2000);
	});
}

export {};
