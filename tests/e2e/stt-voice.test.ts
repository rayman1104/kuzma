import { test, expect, describe, beforeAll } from "bun:test";
import { join } from "path";
import { existsSync, statSync } from "fs";
import { transcribeAudio } from "../../src/stt/parakeet";

const FIXTURES = join(import.meta.dir, "../fixtures/voice");
const TMP = join(import.meta.dir, "../../.tmp");
const PARAKEET_URL = process.env.PARAKEET_URL || "http://localhost:5092";

async function parakeetAvailable(): Promise<boolean> {
  try {
    // The Parakeet server serves a web UI at root — a 200 means it's up
    const res = await fetch(PARAKEET_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function oggToWav(oggPath: string, wavPath: string): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["ffmpeg", "-loglevel", "error", "-y", "-i", oggPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath],
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
}

beforeAll(() => {
  const { mkdirSync } = require("fs");
  mkdirSync(TMP, { recursive: true });
});

// ─── FFmpeg Conversion Tests ────────────────────────────────────────────────

describe("ffmpeg OGG → WAV conversion", () => {
  test("converts hello-world.ogg to WAV", async () => {
    const ogg = join(FIXTURES, "hello-world.ogg");
    const wav = join(TMP, "test-hello-world.wav");
    expect(existsSync(ogg)).toBe(true);

    await oggToWav(ogg, wav);

    expect(existsSync(wav)).toBe(true);
    const size = statSync(wav).size;
    // WAV 16kHz mono PCM for ~1s of speech should be > 10KB
    expect(size).toBeGreaterThan(10_000);
  });

  test("converts silence.ogg to WAV", async () => {
    const ogg = join(FIXTURES, "silence.ogg");
    const wav = join(TMP, "test-silence.wav");

    await oggToWav(ogg, wav);

    expect(existsSync(wav)).toBe(true);
    // 2s of 16kHz mono PCM = ~64KB
    const size = statSync(wav).size;
    expect(size).toBeGreaterThan(50_000);
  });
});

// ─── Parakeet Transcription Tests ───────────────────────────────────────────

describe("parakeet transcription", () => {
  let available = false;

  beforeAll(async () => {
    available = await parakeetAvailable();
    if (!available) {
      console.warn("⚠ Parakeet not running at", PARAKEET_URL, "— skipping transcription tests");
    }
  });

  test("transcribes hello-world", async () => {
    if (!available) return;

    const ogg = join(FIXTURES, "hello-world.ogg");
    const wav = join(TMP, "stt-hello-world.wav");
    await oggToWav(ogg, wav);

    const transcript = await transcribeAudio(wav, PARAKEET_URL);
    const lower = transcript.toLowerCase();

    expect(lower).toContain("hello");
    expect(lower).toContain("world");
  });

  test("transcribes numbers with ≥3/5 accuracy", async () => {
    if (!available) return;

    const ogg = join(FIXTURES, "numbers.ogg");
    const wav = join(TMP, "stt-numbers.wav");
    await oggToWav(ogg, wav);

    const transcript = await transcribeAudio(wav, PARAKEET_URL);
    const lower = transcript.toLowerCase();

    const expected = ["one", "two", "three", "four", "five"];
    const matches = expected.filter(w => lower.includes(w));
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  test("handles silence without crashing", async () => {
    if (!available) return;

    const ogg = join(FIXTURES, "silence.ogg");
    const wav = join(TMP, "stt-silence.wav");
    await oggToWav(ogg, wav);

    const transcript = await transcribeAudio(wav, PARAKEET_URL);
    // Silent audio should produce empty or near-empty transcript
    expect(transcript.length).toBeLessThan(20);
  });
});
