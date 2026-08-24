/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The published site lives at https://marshl.github.io/ofcorsetfits/, so
  // asset URLs need to be prefixed with the repo path. Vite bakes this into
  // the built HTML/JS at build time; `vite dev` and `vite preview` also
  // honour it (they serve from /ofcorsetfits/ locally too, matching prod).
  base: '/ofcorsetfits/',
  plugins: [react()],
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
  },
});
