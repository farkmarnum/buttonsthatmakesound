import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

const enableSsl = process.env.ENABLE_SSL === "1";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ...(enableSsl ? [basicSsl()] : [])],
});
