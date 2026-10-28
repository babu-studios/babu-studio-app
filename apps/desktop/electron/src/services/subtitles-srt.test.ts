import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatSrt, formatSrtTimestamp, isCompliantWavHeader, mapTranslatedTurns, normalizeTranscribeTurns, parseSubtitleTurns } from "./subtitles-srt.js";

describe("formatSrtTimestamp", () => {
  it("formats zero and small values", () => {
    assert.equal(formatSrtTimestamp(0), "00:00:00,000");
    assert.equal(formatSrtTimestamp(1520), "00:00:01,520");
    assert.equal(formatSrtTimestamp(4640), "00:00:04,640");
  });

  it("rolls over minutes and hours", () => {
    assert.equal(formatSrtTimestamp(65_000), "00:01:05,000");
    assert.equal(formatSrtTimestamp(3_661_000), "01:01:01,000");
  });

  it("floors fractions and clamps negatives", () => {
    assert.equal(formatSrtTimestamp(1520.9), "00:00:01,520");
    assert.equal(formatSrtTimestamp(-5), "00:00:00,000");
  });
});

describe("formatSrt", () => {
  it("numbers cues from 1 with CRLF blocks", () => {
    const output = formatSrt([
      { id: 1, startMs: 1520, endMs: 4640, text: "How is the weather?" },
      { id: 2, startMs: 5900, endMs: 8240, text: "It is raining." },
    ]);
    assert.equal(
      output,
      "1\r\n00:00:01,520 --> 00:00:04,640\r\nHow is the weather?\r\n"
      + "\r\n2\r\n00:00:05,900 --> 00:00:08,240\r\nIt is raining.\r\n",
    );
  });

  it("rejects inverted time ranges", () => {
    assert.throws(() => formatSrt([{ id: 1, startMs: 5000, endMs: 1000, text: "x" }]), /time range/);
  });

  it("rejects empty text", () => {
    assert.throws(() => formatSrt([{ id: 1, startMs: 0, endMs: 1000, text: "  " }]), /empty text/);
  });
});

describe("parseSubtitleTurns", () => {
  it("accepts well-formed turns", () => {
    assert.deepEqual(
      parseSubtitleTurns([{ id: 1, startMs: 1520, endMs: 4640, text: "Hi" }]),
      [{ id: 1, startMs: 1520, endMs: 4640, text: "Hi" }],
    );
  });

  it("rejects non-arrays and invented timestamps", () => {
    assert.throws(() => parseSubtitleTurns({}), /array/);
    assert.throws(() => parseSubtitleTurns([{ id: 1, text: "Hi" }]), /time range/);
  });
});

describe("normalizeTranscribeTurns", () => {
  it("drops blank silence turns and keeps the rest", () => {
    assert.deepEqual(
      normalizeTranscribeTurns([
        { turnId: 1, startMs: 0, endMs: 1500, transcript: "  " },
        { turnId: 2, startMs: 1520, endMs: 4640, transcript: "How is the weather?" },
      ]),
      [{ id: 2, startMs: 1520, endMs: 4640, text: "How is the weather?" }],
    );
  });

  it("throws when every turn is blank", () => {
    assert.throws(
      () => normalizeTranscribeTurns([{ turnId: 1, startMs: 0, endMs: 1500, transcript: "" }]),
      /no speech turns/,
    );
  });
});

describe("mapTranslatedTurns", () => {
  const source = [
    { id: 1, startMs: 1520, endMs: 4640, text: "How is the weather?" },
    { id: 2, startMs: 5900, endMs: 8240, text: "It is raining." },
  ];

  it("keeps source timestamps with translated text", () => {
    assert.deepEqual(
      mapTranslatedTurns(source, [
        { id: 1, text: "¿Qué tiempo hace?" },
        { id: 2, text: "Está lloviendo." },
      ]),
      [
        { id: 1, startMs: 1520, endMs: 4640, text: "¿Qué tiempo hace?" },
        { id: 2, startMs: 5900, endMs: 8240, text: "Está lloviendo." },
      ],
    );
  });

  it("rejects count and id mismatches", () => {
    assert.throws(() => mapTranslatedTurns(source, [source[0]]), /1 turns for 2/);
    assert.throws(
      () => mapTranslatedTurns(source, [
        { id: 2, text: "a" },
        { id: 1, text: "b" },
      ]),
      /does not match/,
    );
  });
});

describe("isCompliantWavHeader", () => {
  function header(sampleRate: number, channels: number, bits: number, format = 1): Uint8Array {
    const bytes = new Uint8Array(44);
    const view = new DataView(bytes.buffer);
    const tag = (offset: number, text: string): void => {
      for (let index = 0; index < 4; index += 1) {
        view.setUint8(offset + index, text.charCodeAt(index));
      }
    };
    tag(0, "RIFF");
    tag(8, "WAVE");
    tag(12, "fmt ");
    view.setUint16(20, format, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint16(34, bits, true);
    return bytes;
  }

  it("accepts mono 16-bit PCM at 16 or 24 kHz", () => {
    assert.equal(isCompliantWavHeader(header(16000, 1, 16)), true);
    assert.equal(isCompliantWavHeader(header(24000, 1, 16)), true);
  });

  it("rejects stereo, float, 44.1 kHz, and short buffers", () => {
    assert.equal(isCompliantWavHeader(header(16000, 2, 16)), false);
    assert.equal(isCompliantWavHeader(header(24000, 1, 32, 3)), false);
    assert.equal(isCompliantWavHeader(header(44100, 1, 16)), false);
    assert.equal(isCompliantWavHeader(new Uint8Array(10)), false);
  });
});
