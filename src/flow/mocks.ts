/**
 * Mock implementations for test mode.
 * Replace real API calls with deterministic, realistic responses
 * that exercise all UX paths.
 */

import * as zlib from "node:zlib";
import type { HaikuDnaOutput, SonnetOutput, ApiCallStats } from "../session.js";
import type { SeedResult } from "./seed.js";
import type { ObserveResult } from "./analyze.js";
import type { GenerateResult } from "./generate.js";

// ── Delays (simulate network latency) ────────────────────────────────────

const SEED_DELAY = 300;
const OBSERVE_DELAY = 600;
const IMAGE_DELAY = 400;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Mock stats ──────────────────────────────────────────────────────────

function mockStats(durationMs: number): ApiCallStats {
  return {
    durationMs,
    promptTokens: Math.floor(Math.random() * 200) + 50,
    completionTokens: Math.floor(Math.random() * 300) + 100,
    totalTokens: 0, // filled below
  };
}

// ── Seed synthesis mock ─────────────────────────────────────────────────

const MOCK_DNA: Record<string, HaikuDnaOutput> = {
  default: {
    subject: "A weathered healer with knowing hands",
    object: "An ancient orthotic mold, cracked but still holding its shape",
    environment: "A liminal space between clinical sterility and wild nature — a greenhouse laboratory",
    actions: ["pressing", "listening", "reshaping"],
    feeling: "Quiet determination tinged with tenderness",
    texture: "Smooth ceramic against calloused fingertips, warm and slightly damp",
    tempo: "Slow and deliberate, like a heartbeat at rest",
    color_mood: "Deep forest green dissolving into gold at the edges",
    symbolism: "The bridge between brokenness and restoration — kintsugi for the body",
    tension: "Precision vs. intuition, science vs. art of healing",
    transformation: "Raw discomfort becoming supported movement, pain becoming understanding",
  },
};

export async function mockSynthesizeSeed(seedWord: string): Promise<SeedResult> {
  await delay(SEED_DELAY);

  const dna = { ...MOCK_DNA.default };
  // Personalize subject based on seed
  dna.subject = `A figure embodying "${seedWord}" — present and searching`;
  dna.symbolism = `The essence of "${seedWord}" as a portal to deeper truth`;

  const stats = mockStats(SEED_DELAY);
  stats.totalTokens = stats.promptTokens + stats.completionTokens;

  return {
    dna,
    stats,
    systemPrompt: "[MOCK] Haiku DNA system prompt",
    userPrompt: seedWord,
  };
}

// ── Observe mock ────────────────────────────────────────────────────────

export async function mockObserveSeed(
  seedWord: string,
  _dna: HaikuDnaOutput,
): Promise<ObserveResult> {
  await delay(OBSERVE_DELAY);

  const output: SonnetOutput = {
    observation: `Consciousness witnesses "${seedWord}" unfolding: a moment of recognition where the familiar becomes strange, the clinical becomes poetic. The seed carries within it both the wound and the salve.`,
    goal: `This visual serves as a scroll-stopping social media banner that captures the emotional core of "${seedWord}" — designed to provoke pause, recognition, and curiosity in a medical education audience.`,
    style: "cinematic medical realism with poetic undertones — dark green depths punctuated by neon precision",
    caption: `When "${seedWord}" becomes visible, everything changes. Look closer.`,
    scene: `Close-up composition in a dark green environment. A pair of hands (weathered, professional) cradle a glowing orthotic form that seems to pulse with inner light. Neon green accents trace the contours. The background fades from clinical precision to organic texture. Dramatic side lighting creates strong shadows. 1280x720 banner format.`,
    headline: "ПОДИВІТЬСЯ БЛИЖЧЕ",
    secondary: "Те що ви бачите змінює все",
  };

  const stats = mockStats(OBSERVE_DELAY);
  stats.totalTokens = stats.promptTokens + stats.completionTokens;

  return {
    output,
    stats,
    systemPrompt: "[MOCK] Sonnet consciousness system prompt",
    userPrompt: `[MOCK] Seed: "${seedWord}" + DNA traits`,
  };
}

// ── Image mock ───────────────────────────────────────────────────────────

/**
 * Generate a minimal valid PNG image buffer.
 * Creates a small solid-color image (4x4 px) — enough to prove the
 * image delivery path works end-to-end.
 */
function createMockPng(): Buffer {
  // Minimal 4x4 PNG, solid dark green (#1B4D3E) — brand color
  const width = 4;
  const height = 4;

  const rawRows: number[] = [];
  for (let y = 0; y < height; y++) {
    rawRows.push(0); // filter: None
    for (let x = 0; x < width; x++) {
      rawRows.push(0x1b, 0x4d, 0x3e); // RGB
    }
  }

  const rawData = Buffer.from(rawRows);
  const compressed = zlib.deflateSync(rawData);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", compressed);
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table.push(c >>> 0);
  }
  return table;
})();

const MOCK_PNG = createMockPng();

export async function mockGenerateImage(
  _prompt: string,
): Promise<GenerateResult> {
  await delay(IMAGE_DELAY);

  const stats = mockStats(IMAGE_DELAY);
  stats.totalTokens = stats.promptTokens + stats.completionTokens;

  return {
    imageBuffer: MOCK_PNG,
    stats,
  };
}
