// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  // Served by GitHub Pages from the user-site repo (mohammadyarahamadi.github.io), so at
  // the domain root. If the site ever moves into a subfolder (a repo with
  // another name), set base to that folder, e.g. '/portfolio-website/'.
  site: 'https://mohammadyarahamadi.github.io',
  base: '/',
  integrations: [react()],
  vite: {
    build: {
      // three.js is ~620 KB minified (160 KB gzip). It is only ever loaded
      // through a dynamic import on the ROV page, so the default 500 KB
      // warning is expected noise.
      chunkSizeWarningLimit: 700,
    },
  },
});