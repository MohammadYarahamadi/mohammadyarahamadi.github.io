/**
 * Remembers the choices on /deep/ (the mood and the view): restores each
 * from its URL parameter (?vibe=, ?view=) or localStorage on load, and
 * saves it on change. The restyling itself is pure CSS (deep.css reads the
 * checked radios), so this file is optional.
 *
 * It also switches the page between the plain welcome colours and the
 * picked mood: data-zone="welcome" stays on <html> until the project
 * picker comes up to the middle of the screen.
 */

function stored(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

for (const name of ["vibe", "view"]) {
	const key = `deep-${name}`;
	const radios = [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
	const wanted = new URLSearchParams(location.search).get(name) ?? stored(key);
	const start = radios.find((r) => r.value === wanted);
	if (start) start.checked = true;

	for (const r of radios) {
		r.addEventListener("change", () => {
			try {
				localStorage.setItem(key, r.value);
			} catch {
				// private mode: the choice just isn't remembered
			}
			const url = new URL(location.href);
			url.searchParams.set(name, r.value);
			history.replaceState(null, "", url);
			document.dispatchEvent(new CustomEvent("deep:change", { detail: { name, value: r.value } }));
		});
	}
}

// On phones the picker is a sideways-scrolling row: bring the picked chip
// into view (without scrolling the page itself).
const chip = document.querySelector('input[name="vibe"]:checked')?.closest("label");
const row = chip?.parentElement;
if (chip && row && row.scrollWidth > row.clientWidth) {
	row.scrollLeft = chip.offsetLeft - row.offsetLeft - 16;
}

// ---- welcome zone ----
const root = document.documentElement;
const projects = document.getElementById("projects")!;
let queued = false;
function zone() {
	queued = false;
	const welcome = projects.getBoundingClientRect().top > innerHeight * 0.5;
	if (welcome) root.dataset.zone = "welcome";
	else delete root.dataset.zone;
}
const queue = () => {
	if (!queued) {
		queued = true;
		requestAnimationFrame(zone);
	}
};
addEventListener("scroll", queue, { passive: true });
addEventListener("resize", queue);
document.addEventListener("deep:change", queue);
zone();

export {};
