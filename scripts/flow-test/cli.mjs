export function fail(message) {
  throw new Error(message);
}

function option(name, fallback) {
  const prefix = `--${name}=`;
  const equalForm = process.argv.find((argument) => argument.startsWith(prefix));
  if (equalForm) {
    return equalForm.slice(prefix.length);
  }
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export function getCliConfig() {
  const durationMs = Number(option("duration-ms", "60000"));
  const exportOption = option("exports", "both").toLowerCase();
  const keepOutput = process.argv.includes("--keep");
  const exportModes = exportOption === "both"
    ? ["HORIZONTAL", "VERTICAL"]
    : exportOption === "horizontal"
      ? ["HORIZONTAL"]
      : exportOption === "vertical"
        ? ["VERTICAL"]
        : [];
  if (!Number.isInteger(durationMs) || durationMs < 1_000 || durationMs > 3_600_000) {
    fail("--duration-ms must be between 1000 and 3600000.");
  }
  if (exportModes.length === 0) {
    fail("--exports must be both, horizontal, or vertical.");
  }
  return { durationMs, exportModes, keepOutput };
}
