// Meta speech-to-text client for multilingual subtitles (main process only).
//
// Documented API (verified against dev.meta.ai during planning):
// POST https://api.meta.ai/v1/asr/transcribe with multipart parts `request`
// (JSON: model, audioEncoding, mode) and `audio` (WAV file); Bearer
// MODEL_API_KEY; Accept: application/json returns TranscribeResponse with
// transcript, audioDurationMs, and turns[] of turnId/startMs/endMs/transcript.
// Turns are empty in PUSH_TO_TALK, so DIARIZATION is used. Accepted audio is
// RIFF/WAVE mono 16-bit integer PCM at 16 kHz or 24 kHz; anything else is
// converted with ffmpeg -ar 24000 (the model's native rate) before upload.
import { stat } from "node:fs/promises";
import https from "node:https";
import { HIGHLIGHTS_ENV_VAR, completeModelText, resolveModelApiKey } from "./ai-highlights.provider";
import { mapTranslatedTurns, normalizeTranscribeTurns, type SubtitleTurn } from "./subtitles-srt.js";

export const TRANSCRIBE_API_BASE = "https://api.meta.ai";
export const TRANSCRIBE_MODEL_ID = "muse-voice-transcribe-1.0";
const TRANSCRIBE_TIMEOUT_MS = 600_000;

export type TranscribeResult = {
  transcript: string;
  audioDurationMs: number;
  turns: SubtitleTurn[];
};

export type TranslatedLanguage = {
  code: string;
  name: string;
};

/** Transcribes a compliant WAV file. Reports upload bytes as 0..1. */
export async function transcribeWav(
  wavPath: string,
  signal: AbortSignal,
  onUploadProgress?: (fraction: number) => void,
): Promise<TranscribeResult> {
  const apiKey = await resolveModelApiKey();
  if (!apiKey) {
    throw new Error(
      `Transcription is not configured. Add your Model API key in the AI popup (AI clips > Model API key), or set the ${HIGHLIGHTS_ENV_VAR} environment variable and restart Babu Studio.`,
    );
  }
  const settings = JSON.stringify({ mode: "DIARIZATION", model: TRANSCRIBE_MODEL_ID, audioEncoding: "WAV" });
  const response = await postWav("/v1/asr/transcribe", apiKey, settings, wavPath, signal, onUploadProgress);
  if (response.status === 401 || response.status === 403) {
    throw new Error("The Model API key was rejected. Check the key and restart Babu Studio.");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Transcription failed (HTTP ${response.status}).`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(response.text);
  } catch {
    throw new Error("Transcription returned an unreadable response.");
  }
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Transcription returned an unreadable response.");
  }
  const record = payload as Record<string, unknown>;
  const turns = normalizeTranscribeTurns(record.turns);
  return {
    transcript: typeof record.transcript === "string" ? record.transcript : "",
    audioDurationMs: typeof record.audioDurationMs === "number" ? record.audioDurationMs : 0,
    turns,
  };
}

/** Translates turn texts, preserving source ids and timestamps. */
export async function translateTurns(
  turns: SubtitleTurn[],
  language: TranslatedLanguage,
  signal: AbortSignal,
): Promise<SubtitleTurn[]> {
  const prompt = [
    `Translate each subtitle line to ${language.name}.`,
    "Return ONLY a JSON array of objects with exactly these keys: id (the same integer id), text (the translation).",
    "Keep the same number of entries in the same order. Do not add, remove, or renumber entries.",
    "Do not include timestamps, explanations, or code fences.",
    JSON.stringify(turns.map((turn) => ({ id: turn.id, text: turn.text }))),
  ].join("\n");
  const answer = await completeModelText(prompt, signal);
  const parsed = parseTranslatedTexts(answer);
  return mapTranslatedTurns(turns, parsed);
}

function parseTranslatedTexts(answer: string): Array<{ id: number; text: string }> {
  const start = answer.indexOf("[");
  const end = answer.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error(`Translation to the target language returned no usable entries.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(answer.slice(start, end + 1));
  } catch {
    throw new Error(`Translation to the target language returned unreadable entries.`);
  }
  if (!Array.isArray(raw)) {
    throw new Error(`Translation to the target language returned no usable entries.`);
  }
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`Translation entry ${index} is not an object.`);
    }
    const record = entry as Record<string, unknown>;
    if (!Number.isInteger(record.id) || typeof record.text !== "string" || record.text.trim().length === 0) {
      throw new Error(`Translation entry ${index} is missing an id or text.`);
    }
    return { id: record.id as number, text: (record.text as string).trim() };
  });
}

function postWav(
  path: string,
  apiKey: string,
  settingsJson: string,
  wavPath: string,
  signal: AbortSignal,
  onUploadProgress?: (fraction: number) => void,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Transcription cancelled"));
      return;
    }
    void stat(wavPath).then(
      (info) => {
        const boundary = `----babu${Date.now().toString(16)}`;
        const settingsPart = Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="request"; Content-Type: application/json\r\n\r\n${settingsJson}\r\n`,
          "utf8",
        );
        const audioHeader = Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="microphone.wav"; Content-Type: audio/wav\r\n\r\n`,
          "utf8",
        );
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
        const total = settingsPart.length + audioHeader.length + info.size + footer.length;
        let sent = 0;
        const report = (): void => {
          onUploadProgress?.(Math.min(sent / total, 1));
        };
        const request = https.request(
          TRANSCRIBE_API_BASE,
          {
            path,
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              Accept: "application/json",
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
              "Content-Length": total,
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
        const timer = setTimeout(() => request.destroy(new Error("Transcription timed out.")), TRANSCRIBE_TIMEOUT_MS);
        request.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        request.on("close", () => clearTimeout(timer));
        signal.addEventListener("abort", () => request.destroy(new Error("Transcription cancelled")), { once: true });
        request.write(settingsPart);
        sent += settingsPart.length;
        request.write(audioHeader);
        sent += audioHeader.length;
        report();
        void import("node:fs").then(({ createReadStream }) => {
          const stream = createReadStream(wavPath);
          stream.on("error", (error) => request.destroy(error));
          stream.on("data", (chunk: Buffer | string) => {
            sent += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
            report();
          });
          stream.on("end", () => {
            sent = total;
            report();
            request.end(footer);
          });
          stream.pipe(request, { end: false });
        }, reject);
      },
      reject,
    );
  });
}
