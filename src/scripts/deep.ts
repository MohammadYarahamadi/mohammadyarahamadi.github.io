/**
 * Remembers the choices on /projects/ (the picked project): restores it
 * from its URL parameter (?vibe=) or localStorage on load, and
 * saves it on change. The homepage's project doors link here with ?vibe=.
 * The restyling itself is pure CSS (deep.css reads the checked radios), so
 * this file is optional.
 */

function stored(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

for (const name of ["vibe"]) {
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

export {};
