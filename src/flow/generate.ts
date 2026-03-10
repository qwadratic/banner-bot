import { deflateSync } from "node:zlib";
import type { ModuleSet, SonnetOutput } from "../session.js";
import { CONFIG } from "../config.js";

// Phase 1: Mock Nano Banana — returns a solid dark green 1280x720 PNG
// with "MOCK BANNER" text after 3s delay

function createMockPng(): Buffer {
  // Minimal valid PNG: 1x1 dark green pixel, scaled display
  // For Phase 1 we generate a simple valid PNG using raw bytes
  // This is a 1280x720 image with solid #1B4D3E color

  // We'll create a proper PNG by constructing it manually
  // For simplicity, use a small PNG that Telegram can display
  const width = 1280;
  const height = 720;

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type: RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk("IHDR", ihdrData);

  // IDAT chunk - raw image data with zlib
  // Each row: filter byte (0) + RGB pixels
  const rowSize = 1 + width * 3;
  const rawData = Buffer.alloc(rowSize * height);
  const r = 0x1B, g = 0x4D, b = 0x3E; // #1B4D3E
  for (let y = 0; y < height; y++) {
    const offset = y * rowSize;
    rawData[offset] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const px = offset + 1 + x * 3;
      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
    }
  }

  // Add simple white text area in center (approximate "MOCK BANNER")
  // Draw a white rectangle in the center
  const textY1 = 330, textY2 = 390;
  const textX1 = 440, textX2 = 840;
  for (let y = textY1; y < textY2; y++) {
    const offset = y * rowSize;
    for (let x = textX1; x < textX2; x++) {
      const px = offset + 1 + x * 3;
      rawData[px] = 0xFF;
      rawData[px + 1] = 0xFF;
      rawData[px + 2] = 0xFF;
    }
  }

  // Compress with zlib
  const compressed = deflateSync(rawData);
  const idat = makeChunk("IDAT", compressed);

  // IEND chunk
  const iend = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makeChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = crc32(crcInput);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBytes, data, crcBuf]);
}

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return ~crc;
}

export function assemblePrompt(
  modules: ModuleSet,
  userOverrides: Partial<ModuleSet>,
  sonnetOutput: SonnetOutput,
): string {
  const effective = { ...modules, ...userOverrides };
  const modulesBlock = Object.entries(effective)
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");

  return CONFIG.imagePromptTemplate
    .replace("{modules}", modulesBlock)
    .replace("{scene}", sonnetOutput.scene)
    .replace("{headline}", sonnetOutput.headline)
    .replace("{secondary}", sonnetOutput.secondary);
}

// Phase 1: Mock image generation — returns a placeholder PNG
export async function generateImage(
  _prompt: string,
  _detectedStage: string,
): Promise<Buffer> {
  await new Promise((r) => setTimeout(r, 3_000));
  return createMockPng();
}
