let lastFocused: HTMLElement | null = null;
let activeModal: HTMLElement | null = null;

function getFocusable(container: HTMLElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>(
			'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
		),
	);
}

function openModal(modal: HTMLElement) {
	lastFocused = document.activeElement as HTMLElement | null;
	activeModal = modal;

	modal.hidden = false;
	// Force layout so the opacity/transform transition actually runs.
	modal.getBoundingClientRect();
	modal.setAttribute("data-open", "");

	document.body.style.overflow = "hidden";

	const focusable = getFocusable(modal);
	(focusable[0] ?? modal).focus();
}

function closeModal() {
	if (!activeModal) return;

	activeModal.removeAttribute("data-open");
	document.body.style.overflow = "";

	const modalToHide = activeModal;
	activeModal = null;

	setTimeout(() => {
		modalToHide.hidden = true;
	}, 200);

	lastFocused?.focus();
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
