import { defineConfig } from 'vite';

const ARCGIS_CDN = 'https://js.arcgis.com/5.0/';

/**
 * Keep @arcgis/core off the Vite bundle.
 * - serve: rewrite to absolute CDN URLs (Vite leaves https imports alone)
 * - build: leave bare specifiers for the HTML import map
 */
function arcgisExternal(command) {
  return {
    name: 'arcgis-external',
    enforce: 'pre',
    resolveId(id) {
      if (!id.startsWith('@arcgis/core')) return;
      if (command === 'serve') {
        return { id: `${ARCGIS_CDN}${id}`, external: true };
      }
      return { id, external: true };
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [arcgisExternal(command)],
  build: {
    rollupOptions: {
      external: (id) =>
        id.startsWith('@arcgis/core') || id.startsWith(ARCGIS_CDN),
    },
  },
  optimizeDeps: {
    exclude: ['@arcgis/core'],
  },
}));
