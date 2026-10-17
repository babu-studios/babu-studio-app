import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { EXPORT_RESOLUTIONS } from "@shared/constants/media.constants";
import type { StudioConfiguration } from "@shared/types/studio-config";

export class StudioConfigService {
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly configPath: string) {}

  async load(): Promise<StudioConfiguration | null> {
    let contents: string;
    try {
      contents = await readFile(this.configPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }

    const parsed: unknown = JSON.parse(contents);
    if (!isStudioConfiguration(parsed)) {
      throw new Error(`Studio configuration at ${this.configPath} has an unsupported format.`);
    }
    return parsed;
  }

  async save(configuration: StudioConfiguration): Promise<void> {
    if (!isStudioConfiguration(configuration)) {
      throw new Error("Refusing to save an invalid studio configuration.");
    }

    const saveOperation = this.saveQueue.then(() => this.write(configuration));
    this.saveQueue = saveOperation.catch(() => undefined);
    return saveOperation;
  }

  private async write(configuration: StudioConfiguration): Promise<void> {
    const temporaryPath = `${this.configPath}.tmp`;
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(configuration, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.configPath);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStudioConfiguration(value: unknown): value is StudioConfiguration {
  return isRecord(value)
    && value.version === 1
    && isRecord(value.studio)
    && isRecord(value.audioMixer)
    && isRecord(value.exportSettings)
    && Array.isArray(value.exportSettings.modes)
    && value.exportSettings.modes.length > 0
    && value.exportSettings.modes.every((mode) => mode === "HORIZONTAL" || mode === "VERTICAL")
    && typeof value.exportSettings.resolution === "string"
    && Object.hasOwn(EXPORT_RESOLUTIONS, value.exportSettings.resolution)
    && isRecord(value.preview)
    && typeof value.preview.landscape === "boolean"
    && typeof value.preview.portrait === "boolean";
}
