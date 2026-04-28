import { cleanupExpiredArtifacts } from "../services/artifacts.js";

async function main() {
  const result = await cleanupExpiredArtifacts();
  console.log(
    `Artifact retention cleanup removed ${result.artifacts} files across ${result.jobs} jobs`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
