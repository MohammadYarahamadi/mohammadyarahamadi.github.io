// Keep in sync with the .modal opacity transition in ProjectModal.astro.
const TRANSITION_MS = 200;

let lastFocused: HTMLElement | null = null;
let activeModal: HTMLElement | null = null;

// A modal stays in the DOM (visible but fading) for TRANSITION_MS after close.
// Tracking that pending hide lets us cancel it if the same modal is reopened
// mid-fade — otherwise the stale timer hides the freshly-opened modal and
// leaves the page scroll-locked with nothing on screen.
let pendingHide: { el: HTMLElement; timer: number } | null = null;

function flushPendingHide() {
	if (!pendingHide) return;
	clearTimeout(pendingHide.timer);
	pendingHide.el.hidden = true;
	pendingHide = null;
}

function getFocusable(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>(
			'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
		),
	);
}

// Hide page content from assistive tech and the tab order while a modal is
// open. Modals are rendered outside <main> (see BaseLayout's overlays slot)
// so they aren't caught by this.
function setBackgroundInert(inert: boolean) {
	for (const el of document.querySelectorAll<HTMLElement>(
		"header, main, footer",
	)) {
		if (inert) {
			el.setAttribute("inert", "");
		} else {
			el.removeAttribute("inert");
		}
	}
}

function openModal(modal: HTMLElement) {
	flushPendingHide();

	if (activeModal && activeModal !== modal) {
		activeModal.removeAttribute("data-open");
		activeModal.hidden = true;
	}

	lastFocused = document.activeElement as HTMLElement | null;
	activeModal = modal;

	modal.hidden = false;
	// Force layout so the opacity/transform transition actually runs.
	modal.getBoundingClientRect();
	modal.setAttribute("data-open", "");

	document.body.style.overflow = "hidden";
	setBackgroundInert(true);

	const focusable = getFocusable(modal);
	(focusable[0] ?? modal).focus();
}

function closeModal() {
	if (!activeModal) return;

	const modal = activeModal;
	activeModal = null;

	modal.removeAttribute("data-open");
	document.body.style.overflow = "";
	// Must happen before restoring focus — the element we're returning focus
	// to lives inside the region that was inert.
	setBackgroundInert(false);

	pendingHide = {
		el: modal,
		timer: window.setTimeout(() => {
			modal.hidden = true;
			pendingHide = null;
		}, TRANSITION_MS),
	};

	lastFocused?.focus();
	lastFocused = null;
}

document.addEventListener("click", (event) => {
	const target = event.target as HTMLElement;

	const opener = target.closest<HTMLElement>("[data-open-project]");
	if (opener) {
		const id = opener.dataset.openProject;
		const modal = document.getElementById(`modal-${id}`);
		if (modal) openModal(modal);
		return;
	}

	if (target.closest("[data-close-modal]")) {
		closeModal();
		return;
	}

	if (activeModal && target === activeModal) {
		closeModal();
	}
});

document.addEventListener("keydown", (event) => {
	if (!activeModal) return;

	if (event.key === "Escape") {
		closeModal();
		return;
	}

	if (event.key === "Tab") {
		const focusable = getFocusable(activeModal);
		if (focusable.length === 0) return;

		const first = focusable[0];
		const last = focusable[focusable.length - 1];

		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}
});
