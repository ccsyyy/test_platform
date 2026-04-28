import { createApp } from "./app.js";
import { config } from "./config.js";
import { pingMysql } from "./db/mysql.js";
import { pingRedis } from "./db/redis.js";
import { startArtifactRetentionScheduler } from "./services/artifacts.js";

async function main() {
  await Promise.all([pingMysql(), pingRedis()]);
  const app = createApp();
  startArtifactRetentionScheduler();
  app.listen(config.PORT, () => {
    console.log(`API server listening on http://localhost:${config.PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
