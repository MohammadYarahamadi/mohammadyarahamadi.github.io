// threshold: 0 (rather than a fraction) so that elements taller than the
// viewport still reveal — a section more than ~6x the viewport height can
// never reach a 0.15 ratio and would stay invisible forever. The negative
// bottom rootMargin holds the reveal until the element is a little way in.
const observer = new IntersectionObserver(
	(entries) => {
		for (const entry of entries) {
			if (entry.isIntersecting) {
				entry.target.classList.add("is-visible");
				observer.unobserve(entry.target);
			}
		}
	},
	{ threshold: 0, rootMargin: "0px 0px -10% 0px" },
);

document.querySelectorAll("[data-reveal]").forEach((el) => observer.observe(el));
