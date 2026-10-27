// Meta video-analysis client for AI highlight suggestions (main process only).
//
// Provenance (API research): Muse Spark model id `muse-spark` (also 1.2/1.1,
// muse-wonder-1.0); Responses endpoint POST https://api.meta.ai/v1/responses
// (chat fallback POST https://api.meta.ai/v1/chat/completions); auth is a
// Bearer key from the Model API dashboard (`LLM_<id>_<secret>`); video
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
import type { AiHighlightSuggestion } from "@shared/types/media";

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

function extractResponseText(payload: unknown): string {
  // Responses API shape: { output: [{ content: [{ text }] }] } (plus conveniences).
  if (typeof payload === "object" && payload !== null) {
    const root = payload as Record<string, unknown>;
    if (typeof root.output_text === "string" && root.output_text.length > 0) {
      return root.output_text;
    }
    const output = root.output;
    if (Array.isArray(output)) {
      const texts: string[] = [];
      for (const item of output) {
        const content = (item as Record<string, unknown>).content;
        if (Array.isArray(content)) {
          for (const part of content) {
            const text = (part as Record<string, unknown>).text;
            if (typeof text === "string") {
              texts.push(text);
            }
          }
        }
      }
      if (texts.length > 0) {
        return texts.join("\n");
      }
    }
    const choices = root.choices;
    if (Array.isArray(choices)) {
      const first = choices[0] as Record<string, unknown> | undefined;
      const message = first?.message as Record<string, unknown> | undefined;
      if (typeof message?.content === "string") {
        return message.content;
      }
    }
  }
  return String(payload ?? "");
}

function buildPrompt(durationSeconds: number): string {
  return [
    "Analyze this gameplay video and suggest 3 to 5 potentially entertaining short clips.",
    "Look for fights, clutch plays, funny moments, surprising events, and exciting action.",
    `The video is ${durationSeconds.toFixed(1)} seconds long. Time 0 is the start.`,
    "Return the start and end timestamps in seconds relative to the beginning of the video.",
    "For each suggestion include start_time, end_time, category, title, and reason.",
    "Return the results as JSON: ONLY a JSON array (no markdown, no prose) where each",
    "entry has exactly {\"start_time\": <seconds, number>, \"end_time\": <seconds, number>,",
    " \"category\": \"<short label>\", \"title\": \"<short title>\",",
    " \"reason\": \"<one sentence why this moment is a highlight>\"}.",
    "Rules: 0 <= start_time < end_time <= video length; each clip 30-40 seconds.",
  ].join(" ");
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

// --- Validation (pure; no I/O) ---------------------------------------------

const CATEGORY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_CLIP_SECONDS = 30;
const MAX_CLIP_SECONDS = 120;

function sanitizeCategory(value: unknown, index: number): string {
  if (typeof value === "string") {
    const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
    if (slug.length > 0 && CATEGORY_PATTERN.test(slug)) {
      return slug;
    }
  }
  return `moment-${index + 1}`;
}

function sanitizeText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value === "string") {
    const cleaned = value.replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
    if (cleaned.length > 0) {
      return cleaned;
    }
  }
  return fallback;
}

/** Parse/validate raw model output into AI suggestions. Malformed entries are dropped. */
export function parseHighlightSuggestions(raw: unknown, durationSeconds: number, model: string): AiHighlightSuggestion[] {
  void model;
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  if (duration <= 0) {
    return [];
  }
  let text = "";
  if (typeof raw === "string") {
    text = raw;
  } else if (Array.isArray(raw)) {
    return validateEntries(raw, duration);
  } else {
    return [];
  }
  // Tolerate markdown fences around the JSON array.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start < 0 || end <= start) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return validateEntries(parsed, duration);
}

function validateEntries(entries: unknown[], duration: number): AiHighlightSuggestion[] {
  const valid: AiHighlightSuggestion[] = [];
  entries.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      return;
    }
    const record = entry as Record<string, unknown>;
    const startRaw = record.start_time ?? record.startTime;
    const endRaw = record.end_time ?? record.endTime;
    const start = typeof startRaw === "number" ? startRaw : Number(startRaw);
    const end = typeof endRaw === "number" ? endRaw : Number(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return;
    }
    // Clamp to the measured duration, then pad short moments out to a
    // watchable minimum (centered on the suggestion, clamped to the video).
    const clampedStart = Math.min(Math.max(0, start), Math.max(0, duration - 0.5));
    const clampedEnd = Math.min(Math.max(0, end), duration);
    const target = Math.min(MIN_CLIP_SECONDS, duration);
    let paddedStart = clampedStart;
    let paddedEnd = clampedEnd;
    if (paddedEnd - paddedStart < target) {
      const center = (paddedStart + paddedEnd) / 2;
      paddedStart = Math.min(Math.max(0, center - target / 2), Math.max(0, duration - target));
      paddedEnd = Math.min(duration, paddedStart + target);
    }
    const length = paddedEnd - paddedStart;
    if (!(paddedStart < paddedEnd) || length + 1e-6 < target || length > MAX_CLIP_SECONDS) {
      return;
    }
    let confidence = Number(record.confidence);
    if (!Number.isFinite(confidence)) {
      confidence = 0.5;
    }
    confidence = Math.min(1, Math.max(0, confidence));
    valid.push({
      startTime: Math.round(paddedStart * 1000) / 1000,
      endTime: Math.round(paddedEnd * 1000) / 1000,
      category: sanitizeCategory(record.category, index),
      title: sanitizeText(record.title, `Highlight ${valid.length + 1}`, 80),
      reason: sanitizeText(record.reason, "Suggested by AI.", 240),
      confidence,
      source: "ai",
    });
  });
  // Sort by start time; drop only heavily overlapping entries (overlap above
  // 60% of the shorter clip), keeping the higher-confidence one. Padding to
  // the 30-second minimum creates light overlaps that must survive.
  valid.sort((a, b) => a.startTime - b.startTime || b.confidence - a.confidence);
  const deduped: AiHighlightSuggestion[] = [];
  for (const clip of valid) {
    const previous = deduped[deduped.length - 1];
    if (previous && clip.startTime < previous.endTime) {
      const overlap = previous.endTime - clip.startTime;
      const shorter = Math.min(previous.endTime - previous.startTime, clip.endTime - clip.startTime);
      if (shorter > 0 && overlap / shorter > 0.6) {
        if (clip.confidence > previous.confidence) {
          deduped[deduped.length - 1] = clip;
        }
        continue;
      }
    }
    deduped.push(clip);
  }
  return deduped.slice(0, 8);
}

/** Safe unique filename: highlight_001_<category>.mp4 (category sanitized). */
export function highlightFileName(index: number, category: string): string {
  const safe = category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "moment";
  const number = String(index + 1).padStart(3, "0");
  return `highlight_${number}_${safe}.mp4`;
}
