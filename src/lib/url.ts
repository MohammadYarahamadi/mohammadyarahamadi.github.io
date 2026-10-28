/**
 * Prefixes a site path with the deploy base (astro.config.mjs `base`), so
 * links and media work when the site is served from a subfolder such as
 * a project repo on GitHub Pages. Pass paths as if from the site root.
 */
const base = import.meta.env.BASE_URL.replace(/\/$/, "");

export const url = (path: string) => base + (path.startsWith("/") ? path : `/${path}`);
