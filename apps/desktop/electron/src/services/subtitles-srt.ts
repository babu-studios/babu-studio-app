// Pure subtitle helpers: SRT formatting and turn validation. Dependency-free
// so they run unmodified under node:test as well as in the Electron bundle.

export type SubtitleTurn = {
  id: number;
  startMs: number;
  endMs: number;
  text: string;
};

/** 1520 -> "00:00:01,520". Negative values clamp to zero. */
export function formatSrtTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  const pad2 = (value: number): string => value.toString().padStart(2, "0");
  const pad3 = (value: number): string => value.toString().padStart(3, "0");
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(millis)}`;
}

/** Turns in array order become cues 1..N. Throws on invalid turns. */
export function formatSrt(turns: SubtitleTurn[]): string {
  return turns.map((turn, index) => {
    assertTurn(turn, index);
    return `${index + 1}\r\n${formatSrtTimestamp(turn.startMs)} --> ${formatSrtTimestamp(turn.endMs)}\r\n${turn.text.trim()}\r\n`;
  }).join("\r\n");
}

function assertTurn(turn: SubtitleTurn, index: number): void {
  if (!Number.isInteger(turn.id)) {
    throw new Error(`Subtitle turn ${index} has no integer id.`);
  }
  if (!Number.isFinite(turn.startMs) || !Number.isFinite(turn.endMs) || turn.startMs < 0 || turn.endMs <= turn.startMs) {
    throw new Error(`Subtitle turn ${index} has an invalid time range.`);
  }
  if (typeof turn.text !== "string" || turn.text.trim().length === 0) {
    throw new Error(`Subtitle turn ${index} has empty text.`);
  }
}

/**
 * Normalizes a transcription response's turns: keeps turnId/text pairs,
 * drops silence turns with blank text, and throws only when nothing
 * speakable remains. Timestamps always come from the response.
 */
export function normalizeTranscribeTurns(rawTurns: unknown): SubtitleTurn[] {
  if (!Array.isArray(rawTurns)) {
    throw new Error("Transcription returned no speech turns. Nothing to subtitle.");
  }
  const mapped = rawTurns.map((entry, index) => {
    const item = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const text = typeof item.transcript === "string" && item.transcript.trim().length > 0
      ? item.transcript
      : typeof item.text === "string" ? item.text : "";
    return {
      id: typeof item.turnId === "number" ? item.turnId : index,
      startMs: item.startMs,
      endMs: item.endMs,
      text,
    };
  }).filter((entry) => entry.text.trim().length > 0);
  if (mapped.length === 0) {
    throw new Error("Transcription returned no speech turns. Nothing to subtitle.");
  }
  return parseSubtitleTurns(mapped);
}

/** Parses .srt content back into turns. Throws on malformed blocks. */
export function parseSrt(content: string): SubtitleTurn[] {
  const blocks = content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  return blocks.map((block, index) => {
    const lines = block.split("\n");
    if (lines.length < 3) {
      throw new Error(`Subtitle block ${index + 1} is incomplete.`);
    }
    const id = Number.parseInt(lines[0], 10);
    const timing = /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/.exec(lines[1] ?? "");
    if (!Number.isInteger(id) || !timing) {
      throw new Error(`Subtitle block ${index + 1} has a bad number or timing.`);
    }
    const toMs = (hours: string, minutes: string, seconds: string, millis: string): number =>
      (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000 + Number(millis);
    const turn: SubtitleTurn = {
      id,
      startMs: toMs(timing[1], timing[2], timing[3], timing[4]),
      endMs: toMs(timing[5], timing[6], timing[7], timing[8]),
      text: lines.slice(2).join("\n"),
    };
    assertTurn(turn, index);
    return turn;
  });
}

/** Strictly parses an unknown value into subtitle turns. Never invents data. */
export function parseSubtitleTurns(raw: unknown): SubtitleTurn[] {
  if (!Array.isArray(raw)) {
    throw new Error("Subtitle turns must be a JSON array.");
  }
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`Subtitle turn ${index} is not an object.`);
    }
    const record = entry as Record<string, unknown>;
    const turn: SubtitleTurn = {
      id: typeof record.id === "number" ? record.id : index,
      startMs: Number(record.startMs),
      endMs: Number(record.endMs),
      text: typeof record.text === "string" ? record.text : "",
    };
    assertTurn(turn, index);
    return turn;
  });
}

/**
 * Validates translated turns against the source: same count, same ids in
 * order. Timestamps always come from the source turns, never the translation.
 */
export function mapTranslatedTurns(source: SubtitleTurn[], translated: Array<{ id: number; text: string }>): SubtitleTurn[] {
  if (translated.length !== source.length) {
    throw new Error(`Translation returned ${translated.length} turns for ${source.length} source turns.`);
  }
  return source.map((origin, index) => {
    const candidate = translated[index];
    if (candidate.id !== origin.id) {
      throw new Error(`Translation turn ${index} id ${candidate.id} does not match source id ${origin.id}.`);
    }
    if (candidate.text.trim().length === 0) {
      throw new Error(`Translation turn ${index} has empty text.`);
    }
    return { id: origin.id, startMs: origin.startMs, endMs: origin.endMs, text: candidate.text.trim() };
  });
}

/**
 * True when the 44-byte WAV header describes mono 16-bit integer PCM at
 * 16 kHz or 24 kHz — the shape the transcription endpoint accepts directly.
 */
export function isCompliantWavHeader(header: Uint8Array): boolean {
  if (header.length < 44) {
    return false;
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const tag = (offset: number): string => String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3),
  );
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt ") {
    return false;
  }
  const audioFormat = view.getUint16(20, true);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  return audioFormat === 1 && channels === 1 && bitsPerSample === 16
    && (sampleRate === 16000 || sampleRate === 24000);
}
