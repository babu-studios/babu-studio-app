import { safeStorage } from "electron";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AiKeySource, AiKeyStatus } from "@shared/types/media";

const CREDENTIALS_VERSION = 1;
const MAX_KEY_LENGTH = 1000;

type CredentialsFile = {
  version: number;
  encrypted: string;
};

function isCredentialsFile(value: unknown): value is CredentialsFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return entry.version === CREDENTIALS_VERSION && typeof entry.encrypted === "string";
}

/**
 * Model API key storage. The key is encrypted with the OS keychain via
 * Electron safeStorage and kept in the app's userData directory — never in
 * the repository, logs, or renderer-accessible state. Falls back to the
 * MODEL_API_KEY environment variable when no stored key exists.
 */
export class AiCredentialsService {
  constructor(private readonly credentialsPath: string) {}

  private requireEncryption(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable on this system. Set MODEL_API_KEY instead.");
    }
  }

  private async readStored(): Promise<string | null> {
    let contents: string;
    try {
      contents = await readFile(this.credentialsPath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      return null;
    }
    if (!isCredentialsFile(parsed)) {
      return null;
    }
    try {
      return safeStorage.decryptString(Buffer.from(parsed.encrypted, "base64"));
    } catch {
      return null;
    }
  }

  async getStatus(): Promise<AiKeyStatus> {
    const stored = await this.readStored().catch(() => null);
    if (stored) {
      const source: AiKeySource = "secure-storage";
      return { configured: true, source };
    }
    const fromEnv = process.env.MODEL_API_KEY;
    if (fromEnv && fromEnv.length > 0) {
      const source: AiKeySource = "environment";
      return { configured: true, source };
    }
    const source: AiKeySource = "none";
    return { configured: false, source };
  }

  async setKey(plaintext: string): Promise<void> {
    this.requireEncryption();
    if (typeof plaintext !== "string" || plaintext.length === 0 || plaintext.length > MAX_KEY_LENGTH) {
      throw new Error("Provide a valid Model API key.");
    }
    const encrypted = safeStorage.encryptString(plaintext).toString("base64");
    const payload: CredentialsFile = { version: CREDENTIALS_VERSION, encrypted };
    const temporaryPath = `${this.credentialsPath}.tmp`;
    await mkdir(dirname(this.credentialsPath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, "utf8");
    await rename(temporaryPath, this.credentialsPath);
  }

  async clearKey(): Promise<void> {
    await rm(this.credentialsPath, { force: true });
  }

  /** Main-process only: resolve the key for API calls, never for the renderer. */
  async resolveKey(): Promise<string | null> {
    const stored = await this.readStored().catch(() => null);
    if (stored) {
      return stored;
    }
    const fromEnv = process.env.MODEL_API_KEY;
    return fromEnv && fromEnv.length > 0 ? fromEnv : null;
  }
}
