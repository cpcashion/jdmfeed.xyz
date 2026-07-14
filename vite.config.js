import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative base so the build works both at cpcashion.github.io/jdmfeed.xyz
  // and on the custom jdmfeed.xyz domain.
  base: "./",
});
