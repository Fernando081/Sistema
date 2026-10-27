import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: "./ui-tests",
  outputDir: "./test-results",
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4501" },
  webServer: {
    command: "node public-web/build.mjs && node public-web/server.mjs",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    url: "http://127.0.0.1:4501",
    reuseExistingServer: false,
    env: { PUBLIC_WEB_PORT: "4501" },
    timeout: 30000,
  },
});
