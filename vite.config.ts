import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// If deploying to GitHub Pages, set VITE_BASE to your repo name, e.g. 
// VITE_BASE=/Portfolio/
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/',
});
