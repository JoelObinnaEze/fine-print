import { checkMetaCompatibility } from "../apps/server/src/providers/meta-compatibility.js";

try {
  const result = await checkMetaCompatibility(process.env);
  if (!result.modelAvailable) {
    throw new Error(`Account cannot access configured model ${result.modelId}`);
  }

  console.log(
    `Meta compatibility verified: authenticated at ${result.endpoint}; ${result.modelId} is available (${result.modelCount} models visible).`,
  );
} catch (error) {
  console.error(
    `Meta compatibility check failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
}
