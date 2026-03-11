import { execSync } from "node:child_process";
import { TelegramClient, BotKeyboard, InputMedia, md } from "@mtcute/node";
import type { CallbackQueryContext } from "@mtcute/dispatcher";
import { CONFIG, resolvedModels } from "../config.js";
import { globalState } from "../session.js";
import { devAlert } from "../devAlert.js";
import { getAdminUserIds, addAdminUserId, removeAdminUserId } from "../runtimeConfig.js";

export const startTime = Date.now();

// ── Health-check regeneration state ─────────────────────────────────────
const MAX_REGEN_IMAGES = 10;
let healthCheckImages: Array<{ buffer: Buffer; mime: string }> = [];
let healthCheckLastBtnMsgId: number | null = null;
let healthCheckReport: string = "";

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function getGitInfo(): { branch: string; hash: string; message: string } {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    // Get latest non-merge commit
    const log = execSync('git log --no-merges -1 --format="%h|%s"', { encoding: "utf8" }).trim();
    const [hash, ...msgParts] = log.split("|");
    return { branch, hash, message: msgParts.join("|") };
  } catch {
    return { branch: "unknown", hash: "?", message: "" };
  }
}

function formatCET(date: Date): string {
  return date.toLocaleString("en-GB", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function startupMessageText(): string {
  const uptime = formatUptime(Date.now() - startTime);
  const cetTime = formatCET(new Date(startTime));
  const git = getGitInfo();
  return (
    `Up since ${cetTime} CET (${uptime})\n` +
    `${git.branch} ${git.hash}\n` +
    git.message
  );
}

export function devPanelKeyboard() {
  const mockLabel = globalState.testMode ? "UX Mock: ON" : "UX Mock";
  const rows = [
    [
      BotKeyboard.callback("LLM Test", "dev:modeltest"),
      BotKeyboard.callback(mockLabel, "dev:uitest"),
      BotKeyboard.callback("UAT", "dev:usermode"),
    ],
    [
      BotKeyboard.callback("📊 Sessions", "dev:sessions"),
      BotKeyboard.callback("⚙️ Config", "cfg:main"),
    ],
    [
      BotKeyboard.callback("⬇️ Pull & Reboot", "dev:update"),
      BotKeyboard.callback("🔄 Reboot", "dev:restart"),
    ],
  ];

  return BotKeyboard.inline(rows);
}

function backKeyboard() {
  return BotKeyboard.inline([
    [BotKeyboard.callback("← Back", "dev:back")],
  ]);
}

function sessionsText(): string {
  const uptime = formatUptime(Date.now() - startTime);
  const session = globalState.activeSession;

  let text = `🧠 Memory\n\n`;
  text += `Uptime: ${uptime}\n`;
  text += `Test mode: ${globalState.testMode ? "ON" : "OFF"}\n`;
  text += `Dev user mode: ${globalState.devUserMode ? "ON" : "OFF"}\n`;
  text += `Config await: ${globalState.devConfigAwait ? globalState.devConfigAwait.type : "none"}\n\n`;

  if (session) {
    const runtime = formatUptime(Date.now() - session.lastActivityAt);
    const sessionAge = formatUptime(Date.now() - (session.lastActivityAt - 0));
    text += `Active session:\n`;
    text += `  User: ${session.userId}\n`;
    text += `  Session ID: ${session.sessionId.slice(0, 8)}…\n`;
    text += `  Phase: ${session.phase}\n`;
    text += `  Last activity: ${runtime} ago\n`;
    text += `  Stage: ${session.detectedStage ?? "—"}\n`;
    text += `  Confidence: ${session.stageConfidence ?? "—"}\n`;
    text += `  Hints: ${session.selectedHints.stage ?? "—"} / ${session.selectedHints.style ?? "—"}\n`;
    text += `  Generations: ${session.generationCount}\n`;
    text += `  Warning sent: ${session.warningSent ? "yes" : "no"}\n`;
  } else {
    text += `Active session: none`;
  }

  return text;
}

// ── DNA Chain Health Check ──────────────────────────────────────────────
// The health check is a sequential chain that mirrors how DNA unfolds:
//   Haiku (DNA seed) → Sonnet (unfolds to life) → Nano Banana (manifests visually)
// Each model's output feeds into the next, proving the full pipeline works.

interface ChainStep {
  label: string;
  model: string;
  elapsed: number;
  error?: string;
  input?: string;
  output?: string;
  imageBase64?: string;
  imageMime?: string;
}

interface FormatStepOptions {
  showInput?: boolean;
  showOutput?: boolean;
  connector?: string;
}

// The DNA prompt — a compact seed that encodes maximum creative potential.
// Like a real DNA strand, it carries instructions that only reveal their
// meaning when read by the right machinery (the model chain).
const DNA_SEED = `You are the double helix. You carry the code of a single, vivid scene that has never existed.

Your task: emit ONE scene-seed in exactly 3 lines.
Line 1 — ORGANISM: a surreal living creature (combine two real species + one impossible trait)
Line 2 — HABITAT: where it exists (a place that bends one law of physics)
Line 3 — MOMENT: what is happening right now (an action that reveals its soul)

Constraints: no abstractions, no metaphors-about-metaphors. Pure concrete imagery. Every noun must be touchable, every verb must be filmable.

Speak only the three lines. No labels, no numbering, no commentary.`;

const SONNET_UNFOLD = `You are a consciousness that receives a DNA fragment — a raw scene-seed — and unfolds it into lived experience.

Below is the seed. Read it. Inhabit it. Then produce:

1. FEELING (1 sentence): What emotion hits first when you witness this scene?
2. BANNER CONCEPT (2-3 sentences): Translate this scene into a bold, scroll-stopping visual concept for a 1280x720 banner. Describe composition, dominant colors, focal point, and mood. Be specific enough for an image model to render it.
3. TAGLINE (max 8 words): A punchy headline that captures the essence.

Format your response exactly as:
FEELING: ...
BANNER: ...
TAGLINE: ...

The seed:
{haiku_output}`;

const NANO_BANANA_MANIFEST = `Generate a 1280x720 banner image based on this creative direction:

{sonnet_output}

Style: Bold, high-contrast, editorial quality. Dark background with vivid accent colors. Strong typography area at bottom third for the tagline. No actual text in the image — just leave clean space for text overlay.`;

async function callModel(
  model: string,
  prompt: string,
  maxTokens: number,
  apiKey: string,
  timeoutMs: number = 30_000,
): Promise<{ content?: string; imageBase64?: string; imageMime?: string; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const body = await resp.text();
      return { error: `HTTP ${resp.status}: ${body.slice(0, 500)}` };
    }

    const rawBody = await resp.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = JSON.parse(rawBody) as any;

    if (data.error) {
      return { error: `API: ${data.error.message ?? JSON.stringify(data.error)}` };
    }

    const message = data.choices?.[0]?.message;
    const result: { content?: string; imageBase64?: string; imageMime?: string; error?: string } = {};

    const content = message?.content;
    if (typeof content === "string" && content.length > 0) {
      result.content = content;
    }

    // Extract image from message.images[] (OpenRouter/Gemini)
    const images = message?.images as Array<{ image_url?: { url?: string } }> | undefined;
    if (images && images.length > 0) {
      const dataUrl = images[0].image_url?.url ?? "";
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        result.imageMime = m[1];
        result.imageBase64 = m[2];
      }
    }

    if (!result.content && !result.imageBase64) {
      const msgDump = JSON.stringify(message, (_k, v) => {
        if (typeof v === "string" && v.length > 200) return v.slice(0, 200) + "...";
        return v;
      });
      return { error: `No content or image. Raw message: ${msgDump}` };
    }

    return result;
  } catch (err) {
    const msg = err instanceof Error && err.name === "AbortError"
      ? `Timed out (${Math.round(timeoutMs / 1000)}s)`
      : err instanceof Error ? err.message : String(err);
    return { error: msg };
  }
}

/** Sanitize a string so it renders as plain text inside md() */
function plain(s: string): string {
  return md.escape(s).replace(/`/g, "'");
}

function formatChainStep(step: ChainStep, opts: FormatStepOptions = {}): string {
  const icon = step.error ? "❌" : "✅";
  let line = opts.connector ? `${opts.connector}\n` : "";
  line += `${icon} **${step.label}**  ${plain(step.model)}  ${step.elapsed}ms`;
  if (step.error) {
    line += `\n    ${plain(step.error.slice(0, 600))}`;
  }
  if (opts.showInput && step.input) {
    line += `\n    ← ${plain(step.input.slice(0, 200))}`;
  }
  if (opts.showOutput && step.output) {
    line += `\n    → ${plain(step.output.slice(0, 200))}`;
  }
  if (step.imageBase64) {
    const kb = Math.round(step.imageBase64.length * 0.75 / 1024);
    line += `\n    → image ${step.imageMime} ${kb} KB`;
  }
  return line;
}

function regenKeyboard(count: number) {
  if (count >= MAX_REGEN_IMAGES) {
    return BotKeyboard.inline([
      [BotKeyboard.callback("← Back", "dev:back")],
    ]);
  }
  return BotKeyboard.inline([
    [
      BotKeyboard.callback(`🔄 Regenerate (${count}/${MAX_REGEN_IMAGES})`, "dev:regen"),
      BotKeyboard.callback("← Back", "dev:back"),
    ],
  ]);
}

async function runDnaChain(
  apiKey: string,
): Promise<{ steps: ChainStep[]; report: string; imageBuffer?: Buffer; imageMime?: string }> {
  const steps: ChainStep[] = [];

  // ── Step 1: Haiku — the DNA seed ──────────────────────────────────────
  const haikuStart = Date.now();
  const haikuResult = await callModel(resolvedModels.gate, DNA_SEED, 150, apiKey);
  const haikuStep: ChainStep = {
    label: "DNA · Haiku",
    model: resolvedModels.gate,
    elapsed: Date.now() - haikuStart,
    error: haikuResult.error,
    input: DNA_SEED,
    output: haikuResult.content,
  };
  steps.push(haikuStep);

  // ── Step 2: Sonnet — unfolds the DNA ──────────────────────────────────
  let sonnetStep: ChainStep;
  if (haikuResult.content) {
    const sonnetPrompt = SONNET_UNFOLD.replace("{haiku_output}", haikuResult.content);
    const sonnetStart = Date.now();
    const sonnetResult = await callModel(resolvedModels.analyze, sonnetPrompt, 500, apiKey, 60_000);
    sonnetStep = {
      label: "Unfold · Sonnet",
      model: resolvedModels.analyze,
      elapsed: Date.now() - sonnetStart,
      error: sonnetResult.error,
      input: haikuResult.content,
      output: sonnetResult.content,
    };
  } else {
    sonnetStep = {
      label: "Unfold · Sonnet",
      model: resolvedModels.analyze,
      elapsed: 0,
      error: "Skipped — no DNA seed from Haiku",
    };
  }
  steps.push(sonnetStep);

  // ── Step 3: Nano Banana — manifests the vision ────────────────────────
  let imageStep: ChainStep;
  if (sonnetStep.output) {
    const imagePrompt = NANO_BANANA_MANIFEST.replace("{sonnet_output}", sonnetStep.output);
    const imageStart = Date.now();
    const imageResult = await callModel(resolvedModels.image, imagePrompt, 1000, apiKey, 60_000);
    imageStep = {
      label: "Manifest · Nano Banana",
      model: resolvedModels.image,
      elapsed: Date.now() - imageStart,
      error: imageResult.error,
      input: sonnetStep.output,
      output: imageResult.content,
      imageBase64: imageResult.imageBase64,
      imageMime: imageResult.imageMime,
    };
  } else {
    imageStep = {
      label: "Manifest · Nano Banana",
      model: resolvedModels.image,
      elapsed: 0,
      error: "Skipped — no unfolded vision from Sonnet",
    };
  }
  steps.push(imageStep);

  // ── Build report ──────────────────────────────────────────────────────
  const totalElapsed = steps.reduce((sum, s) => sum + s.elapsed, 0);
  const allOk = steps.every((s) => !s.error);
  const statusIcon = allOk ? "🧬" : "⚠️";

  const lines = [
    `${statusIcon} **DNA Chain Health Check**  ${totalElapsed}ms total\n`,
    formatChainStep(steps[0], { showInput: true }),
    formatChainStep(steps[1], { connector: "  ↓", showInput: true, showOutput: true }),
    formatChainStep(steps[2], { connector: "  ↓" }),
  ];

  const report = lines.join("\n");

  let imageBuffer: Buffer | undefined;
  let imageMime: string | undefined;
  if (imageStep.imageBase64 && imageStep.imageMime) {
    imageBuffer = Buffer.from(imageStep.imageBase64, "base64");
    imageMime = imageStep.imageMime;
  }

  return { steps, report, imageBuffer, imageMime };
}

async function runHealthCheck(
  tg: TelegramClient,
  devTgId: number,
): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    await tg.sendText(devTgId, "🧬 Health check\n\n❌ OPENROUTER\_API\_KEY not set");
    return;
  }

  // Reset regeneration state for a fresh health check
  healthCheckImages = [];
  healthCheckLastBtnMsgId = null;
  healthCheckReport = "";

  const { report, imageBuffer, imageMime } = await runDnaChain(apiKey);
  healthCheckReport = report;

  // Send with image if available
  if (imageBuffer && imageMime) {
    healthCheckImages.push({ buffer: imageBuffer, mime: imageMime });
    try {
      const ext = imageMime.split("/")[1] || "png";
      const sent = await tg.sendMedia(
        devTgId,
        InputMedia.photo(new Uint8Array(imageBuffer), { fileName: `dna-healthcheck.${ext}` }),
        {
          caption: md(report),
          replyMarkup: regenKeyboard(healthCheckImages.length),
        },
      );
      healthCheckLastBtnMsgId = sent.id;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await tg.sendText(devTgId, md(`${report}\n\n⚠️ __Failed to attach image: ${md.escape(errMsg.slice(0, 200))}__`));
    }
  } else {
    await tg.sendText(devTgId, md(report));
  }
}

async function runHealthCheckRegen(
  tg: TelegramClient,
  cb: CallbackQueryContext,
  devTgId: number,
): Promise<void> {
  if (healthCheckImages.length >= MAX_REGEN_IMAGES) {
    await cb.answer({ text: `Max ${MAX_REGEN_IMAGES} images reached` });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    await cb.answer({ text: "No API key" });
    return;
  }

  await cb.answer({ text: "Regenerating..." });

  // Remove button from previous message
  if (healthCheckLastBtnMsgId) {
    try {
      await cb.editMessage({ replyMarkup: BotKeyboard.inline([]) });
    } catch {
      // ignore — message may have been deleted
    }
    healthCheckLastBtnMsgId = null;
  }

  const { report, imageBuffer, imageMime } = await runDnaChain(apiKey);
  healthCheckReport = report;

  if (imageBuffer && imageMime) {
    healthCheckImages.push({ buffer: imageBuffer, mime: imageMime });
    try {
      const ext = imageMime.split("/")[1] || "png";
      const sent = await tg.sendMedia(
        devTgId,
        InputMedia.photo(new Uint8Array(imageBuffer), { fileName: `dna-healthcheck-${healthCheckImages.length}.${ext}` }),
        {
          caption: md(report),
          replyMarkup: regenKeyboard(healthCheckImages.length),
        },
      );
      healthCheckLastBtnMsgId = sent.id;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await tg.sendText(devTgId, md(`${report}\n\n⚠️ __Failed to attach image: ${md.escape(errMsg.slice(0, 200))}__`));
    }
  } else {
    // No image produced — send text report with button
    const sent = await tg.sendText(devTgId, md(report), {
      replyMarkup: regenKeyboard(healthCheckImages.length),
    });
    healthCheckLastBtnMsgId = sent.id;
  }
}

async function execShell(cmd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const { exec } = await import("node:child_process");
  return new Promise((resolve) => {
    exec(cmd, { cwd: process.cwd(), timeout: 60000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
        code: error?.code ?? 0,
      });
    });
  });
}

export function shutdownMessageText(): string {
  const uptime = formatUptime(Date.now() - startTime);
  const session = globalState.activeSession;
  let text = `🔴 Bot shutting down\nUptime was: ${uptime}\n`;
  if (session) {
    const sessionStart = new Date(session.lastActivityAt);
    text += `\nActive session:\n`;
    text += `  User: ${session.userId}\n`;
    text += `  Started: ${formatCET(sessionStart)} CET\n`;
    text += `  Phase: ${session.phase}`;
  } else {
    text += `\nNo active session`;
  }
  return text;
}

export async function handleDevCallback(tg: TelegramClient, cb: CallbackQueryContext, devTgId: number): Promise<void> {
  const data = cb.dataStr;
  if (!data?.startsWith("dev:")) {
    await cb.answer({});
    return;
  }

  const action = data.slice(4);

  try {
    switch (action) {
      case "sessions": {
        await cb.answer({});
        await cb.editMessage({
          text: sessionsText(),
          replyMarkup: backKeyboard(),
        });
        break;
      }

      case "modeltest": {
        await cb.answer({ text: "Running model tests..." });
        await runHealthCheck(tg, devTgId);
        break;
      }

      case "regen": {
        await runHealthCheckRegen(tg, cb, devTgId);
        break;
      }

      case "restart": {
        await cb.answer({});
        await cb.editMessage({ text: "🔄 Restarting..." });
        setTimeout(() => process.exit(0), 500);
        break;
      }

      case "update": {
        await cb.answer({});
        await cb.editMessage({ text: "⬇️ Pulling latest code..." });

        const gitResult = await execShell("git pull");
        if (gitResult.code !== 0 || gitResult.stderr.includes("fatal")) {
          const errorText =
            gitResult.stderr || gitResult.stdout || "Unknown git error";
          await tg.sendText(
            devTgId,
            `❌ Git pull failed:\n\n${errorText.slice(0, 3000)}`,
          );
          return;
        }

        await tg.sendText(
          devTgId,
          `✅ Git pull:\n${gitResult.stdout.slice(0, 2000)}`,
        );

        const npmResult = await execShell("npm install");
        if (npmResult.code !== 0) {
          const errorText =
            npmResult.stderr || npmResult.stdout || "Unknown npm error";
          await tg.sendText(
            devTgId,
            `❌ npm install failed:\n\n${errorText.slice(0, 3000)}`,
          );
          return;
        }

        await tg.sendText(devTgId, "🔄 Restarting...");
        setTimeout(() => process.exit(0), 500);
        break;
      }

      case "uitest": {
        globalState.testMode = !globalState.testMode;
        await cb.answer({ text: globalState.testMode ? "UI Test ON — API calls are mocked" : "UI Test OFF — real API calls" });
        await cb.editMessage({
          text: startupMessageText(),
          replyMarkup: devPanelKeyboard(),
        });
        break;
      }

      case "usermode": {
        if (globalState.activeSession) {
          await cb.answer({
            text: "A session is already active",
          });
          return;
        }

        await cb.answer({});
        globalState.devUserMode = true;
        const modeNote = globalState.testMode ? " (🧪 UI test)" : "";
        await cb.editMessage({
          text: `👤 User mode active${modeNote}. Send your funnel message.`,
        });
        break;
      }

      case "admins": {
        await cb.answer({});
        const ids = getAdminUserIds();
        const rows = ids.map((id) => [
          BotKeyboard.callback(`❌ ${id}`, `dev:adm_rm:${id}`),
        ]);
        rows.push([BotKeyboard.callback("➕ Add admin", "dev:adm_add")]);
        rows.push([BotKeyboard.callback("← Back", "dev:back")]);
        const label = ids.length === 0 ? "No admins configured." : `${ids.length} admin(s):`;
        await cb.editMessage({
          text: `👥 Admins\n\n${label}`,
          replyMarkup: BotKeyboard.inline(rows),
        });
        break;
      }

      case "adm_add": {
        await cb.answer({});
        globalState.devConfigAwait = { type: "admin_add", userId: devTgId };
        await cb.editMessage({
          text: "👥 Add admin — send one of:\n• @username\n• forwarded message from the user\n• shared contact",
          replyMarkup: BotKeyboard.inline([
            [BotKeyboard.callback("✕ Cancel", "dev:admins")],
          ]),
        });
        break;
      }

      case "back": {
        await cb.answer({});
        await cb.editMessage({
          text: startupMessageText(),
          replyMarkup: devPanelKeyboard(),
        });
        break;
      }

      default: {
        // Handle dev:adm_rm:<id> pattern
        if (action.startsWith("adm_rm:")) {
          const idToRemove = parseInt(action.slice(7), 10);
          if (!isNaN(idToRemove)) {
            const removed = removeAdminUserId(idToRemove);
            await cb.answer({ text: removed ? `Removed ${idToRemove}` : "Not found" });
            // Re-render admin list
            const ids = getAdminUserIds();
            const rows = ids.map((id) => [
              BotKeyboard.callback(`❌ ${id}`, `dev:adm_rm:${id}`),
            ]);
            rows.push([BotKeyboard.callback("➕ Add admin", "dev:adm_add")]);
            rows.push([BotKeyboard.callback("← Back", "dev:back")]);
            const label = ids.length === 0 ? "No admins configured." : `${ids.length} admin(s):`;
            await cb.editMessage({
              text: `👥 Admins\n\n${label}`,
              replyMarkup: BotKeyboard.inline(rows),
            });
          } else {
            await cb.answer({ text: "Invalid ID" });
          }
          break;
        }
        await cb.answer({ text: "Unknown action" });
      }
    }
  } catch (err) {
    await devAlert(`onDevPanel / ${action}`, err);
    try {
      await cb.answer({ text: "Error — check alerts" });
    } catch {
      // ignore
    }
  }
}
