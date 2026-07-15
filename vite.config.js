import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // App source lives in app/ so the built output can be committed to the
  // repo root — GitHub Pages then serves a working site in BOTH modes
  // ("Deploy from a branch" and "GitHub Actions").
  root: "app",
  // Relative base so the build works both at cpcashion.github.io/jdmfeed.xyz
  // and on the custom jdmfeed.xyz domain.
  base: "./",
});
