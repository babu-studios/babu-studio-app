import type { AiHighlightSuggestion } from "@shared/types/media";

// --- Validation (pure; no I/O) ---------------------------------------------

const CATEGORY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_CLIP_SECONDS = 30;
const MAX_CLIP_SECONDS = 120;
const MIN_CONFIDENCE = 0.7;

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

export function extractResponseText(payload: unknown): string {
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

export function buildPrompt(durationSeconds: number): string {
  return [
    "Analyze this gameplay video and suggest 3 to 5 potentially entertaining short clips.",
    "Look for fights, clutch plays, funny moments, surprising events, and exciting action you are highly confident are entertaining.",
    `The video is ${durationSeconds.toFixed(1)} seconds long. Time 0 is the start.`,
    "Return the start and end timestamps in seconds relative to the beginning of the video.",
    "For each suggestion include start_time, end_time, category, title, reason, and confidence.",
    "Return the results as JSON: ONLY a JSON array (no markdown, no prose) where each",
    "entry has exactly {\"start_time\": <seconds, number>, \"end_time\": <seconds, number>,",
    " \"category\": \"<short label>\", \"title\": \"<short title>\",",
    " \"reason\": \"<one sentence why this moment is a highlight>\",",
    " \"confidence\": <0..1 how certain you are this is a highlight>}.",
    "Rules: 0 <= start_time < end_time <= video length; each clip 30-40 seconds.",
  ].join(" ");
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
    const confidenceProvided = Number.isFinite(Number(record.confidence));
    let confidence = confidenceProvided ? Number(record.confidence) : 0.5;
    confidence = Math.min(1, Math.max(0, confidence));
    // High-confidence bar: a scored suggestion below 70% is dropped. Clips
    // the model did not score pass through instead of vanishing entirely.
    if (confidenceProvided && confidence < MIN_CONFIDENCE) {
      return;
    }
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
