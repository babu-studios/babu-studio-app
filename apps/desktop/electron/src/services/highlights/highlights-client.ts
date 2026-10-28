// Meta video-analysis client for AI highlight suggestions (main process only).
//
// Provenance (API research): Muse Spark model id `muse-spark` (also 1.2/1.1,
// muse-wonder-1.0); Responses endpoint POST https://api.meta.ai/v1/responses
// (chat fallback POST https://api.meta.ai/v1/chat/completions); auth is a
// Bearer [REDACTED] from the Model API dashboard (`LLM_<id>_<secret>`); video
// supplied via the Files API (POST /v1/files, multipart, purpose=user_data,
// referenced by file_id as input_file/input_video) or an input_video video_url
// (public or base64); video/mp4 only, 50 MB inline / 1 GiB upload. No official
// timestamp response schema exists, so timestamps are prompt-driven free text
// parsed here as strict JSON. No official max video-duration limit was found.
//
// Credentials live strictly in the main process via the MODEL_API_KEY
// environment variable and never reach the renderer. When no key (or no
// usable endpoint) is configured this module reports an explicit
// configuration error; the provider seam below lets tests or a future
// provider substitute the network layer without touching callers.
import { stat } from "node:fs/promises";
import https from "node:https";
import { buildPrompt, extractResponseText } from "./highlight-suggestions";

export const HIGHLIGHTS_MODEL_ID = "muse-spark-1.3";
export const HIGHLIGHTS_API_BASE = "https://api.meta.ai";
export const HIGHLIGHTS_ENV_VAR = "MODEL_API_KEY";
const MAX_UPLOAD_BYTES = 1_073_741_824; // 1 GiB Files API limit.

export type HighlightsProvider = {
  analyzeVideo(videoPath: string, durationSeconds: number, signal: AbortSignal): Promise<unknown>;
};

export function getModelApiKey(): string | null {
  const key = process.env[HIGHLIGHTS_ENV_VAR];
  return key && key.length > 0 ? key : null;
}

type KeyResolver = () => Promise<string | null>;

let keyResolver: KeyResolver = async () => getModelApiKey();

/** Main process wires the secure key store here; tests can substitute a stub. */
export function setModelApiKeyResolver(resolver: KeyResolver): void {
  keyResolver = resolver;
}

function postJson(
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  timeoutMs = 120_000,
): Promise<{ status: number; text: string }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Highlight analysis cancelled"));
      return;
    }
    const request = https.request(
      HIGHLIGHTS_API_BASE,
      {
        path,
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          text += chunk;
        });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, text }));
      },
    );
    const timer = setTimeout(() => request.destroy(new Error("Model request timed out.")), timeoutMs);
    request.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.on("close", () => clearTimeout(timer));
    signal.addEventListener("abort", () => request.destroy(new Error("Highlight analysis cancelled")), { once: true });
    request.end(payload);
  });
}

/** Default provider: Files API upload, then Responses API analysis. */
export const metaHighlightsProvider: HighlightsProvider = {
  async analyzeVideo(videoPath: string, durationSeconds: number, signal: AbortSignal): Promise<unknown> {
    const apiKey = await keyResolver();
    if (!apiKey) {
      throw new Error(
        `Highlight analysis is not configured. Add your Model API key in the AI popup (AI clips > Model API key), or set the ${HIGHLIGHTS_ENV_VAR} environment variable and restart Babu Studio.`,
      );
    }
    const size = (await stat(videoPath)).size;
    if (size > MAX_UPLOAD_BYTES) {
      throw new Error("The AI 360p file exceeds the 1 GiB upload limit and cannot be analyzed.");
    }
    // Small-file path stays honest about the documented 50 MB inline limit is
    // handled server-side; everything goes through the Files API reference.
    const fileId = await uploadVideoFile(videoPath, apiKey, signal);
    const response = await postJson(
      "/v1/responses",
      apiKey,
      {
        model: HIGHLIGHTS_MODEL_ID,
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: buildPrompt(durationSeconds) },
              { type: "input_file", file_id: fileId },
            ],
          },
        ],
      },
      signal,
    );
    if (response.status === 401 || response.status === 403) {
      throw new Error("The Model API key was rejected. Check the key and restart Babu Studio.");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Highlight analysis failed (HTTP ${response.status}).`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      throw new Error("Highlight analysis returned an unreadable response.");
    }
    return extractResponseText(parsed);
  },
};

function uploadVideoFile(videoPath: string, apiKey: string, signal: AbortSignal): Promise<string> {
  // Multipart upload without extra libraries: hand-built body, arg-free https.
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Highlight analysis cancelled"));
      return;
    }
    void stat(videoPath).then(
      () => {
        const boundary = `----babu${Date.now().toString(16)}`;
        const header = Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nuser_data\r\n`
          + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="ai-360p.mp4"\r\nContent-Type: video/mp4\r\n\r\n`,
          "utf8",
        );
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
        void stat(videoPath).then(
          (info) => {
            const request = https.request(
              HIGHLIGHTS_API_BASE,
              {
                path: "/v1/files",
                method: "POST",
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": `multipart/form-data; boundary=${boundary}`,
                  "Content-Length": header.length + info.size + footer.length,
                },
              },
              (response) => {
                let text = "";
                response.setEncoding("utf8");
                response.on("data", (chunk: string) => {
                  text += chunk;
                });
                response.on("end", () => {
                  if (response.statusCode === 401 || response.statusCode === 403) {
                    reject(new Error("The Model API key was rejected. Check the key and restart Babu Studio."));
                    return;
                  }
                  if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
                    reject(new Error(`Video upload failed (HTTP ${response.statusCode ?? 0}).`));
                    return;
                  }
                  try {
                    const parsed = JSON.parse(text) as { id?: unknown };
                    if (typeof parsed.id !== "string" || parsed.id.length === 0) {
                      reject(new Error("Video upload returned no file reference."));
                      return;
                    }
                    resolve(parsed.id);
                  } catch {
                    reject(new Error("Video upload returned an unreadable response."));
                  }
                });
              },
            );
            request.on("error", reject);
            signal.addEventListener("abort", () => request.destroy(new Error("Highlight analysis cancelled")), { once: true });
            // Stream the file without loading it into memory.
            void import("node:fs").then(({ createReadStream }) => {
              request.write(header);
              const stream = createReadStream(videoPath);
              stream.on("error", (error) => request.destroy(error));
              stream.on("end", () => request.end(footer));
              stream.pipe(request, { end: false });
            }, reject);
          },
          reject,
        );
      },
      reject,
    );
  });
}
