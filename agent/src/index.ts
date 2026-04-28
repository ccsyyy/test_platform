import { createRecordingSession, login } from "./api.js";
import { config } from "./config.js";
import { runRecorder } from "./recorder.js";

async function main() {
  const token = await login();
  const sessionNo = await createRecordingSession(token);
  console.log(`Recording session created: ${sessionNo}`);
  await runRecorder({
    apiBaseUrl: config.API_BASE_URL,
    token,
    sessionNo,
    startUrl: config.START_URL,
    browser: config.BROWSER,
    headless: config.HEADLESS,
    autoDemo: config.AUTO_DEMO
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
