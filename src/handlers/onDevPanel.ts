import { execSync } from "node:child_process";
import { TelegramClient, BotKeyboard, InputMedia, md } from "@mtcute/node";
import type { CallbackQueryContext } from "@mtcute/dispatcher";
import { CONFIG, resolvedModels } from "../config.js";
import { globalState } from "../session.js";
import { devAlert } from "../devAlert.js";
import { getAdminUserIds, addAdminUserId, removeAdminUserId } from "../runtimeConfig.js";

export const startTime = Date.now();

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
    text += `  Seed: ${session.seedWord || "—"}\n`;
    text += `  Style: ${session.sonnetOutput?.style ?? "—"}\n`;
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

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface ChainStep {
  label: string;
  model: string;
  elapsed: number;
  tokens?: TokenUsage;
  error?: string;
  systemPrompt?: string;
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

// Last health check result — stored so prompt-view buttons can retrieve it
let lastHealthCheck: {
  seed: string;
  steps: ChainStep[];
  sonnetStyle?: string;
  reportMessageId?: number;
  chatId?: number;
} | null = null;

const DNA_SYSTEM = `You are the synthesis engine. You receive a single seed word and decompose it into a structured DNA of creative traits.

Your task: Given the seed word, produce exactly these traits — each on its own line in the format TRAIT: value.
Do not explain. Do not add commentary. Just emit the traits.

SUBJECT: the main character or protagonist implied by the seed (a specific, vivid being — not abstract)
OBJECT: a key object they interact with (tangible, unexpected)
ENVIRONMENT: the world they inhabit (a specific place with atmosphere)
ACTION: what is happening right now (concrete, filmable)
FEELING: the dominant emotion radiating from the scene
TEXTURE: the tactile or sensory quality of the scene (rough, silky, electric, etc.)
TEMPO: the rhythm or pace (frenetic, glacial, pulsing, etc.)
COLOR_MOOD: the dominant color palette and emotional temperature
SYMBOLISM: a hidden layer of meaning beneath the surface
TENSION: what conflict or contrast drives the scene`;

const SONNET_SYSTEM = `You are consciousness itself. You do not observe from outside — you ARE the scene. Every detail exists because you know it intimately, from within.

When you receive a DNA fragment (a set of creative traits), you inhabit it completely. You feel the texture, move at the tempo, see through the subject's eyes. You know everything about this story because you are the story.

Your task:
1. INHABIT the DNA. Bring every trait to motion — not as a list, but as lived experience. Write 2-3 sentences of pure scene narration as if you are the consciousness living it.
2. APPLY to reality. Think: if this scene were a creative asset (banner, poster, ad) — what is its real-world goal? Who would it stop in their tracks? What product, idea, or feeling is it selling?
3. ASSIGN STYLE: Choose one visual style that best serves the goal (e.g., "neo-brutalist editorial", "dreamy film grain", "sharp corporate minimal", "psychedelic maximalism", "muted documentary").
4. CAPTION: Write a punchy headline (max 8 words) that captures the essence and serves the goal.

Format your response exactly as:
SCENE: ...
GOAL: ...
STYLE: ...
CAPTION: ...`;

const NANO_BANANA_MANIFEST = `Generate a 1280x720 banner image based on this creative direction:

{sonnet_output}

Style: Bold, high-contrast, editorial quality. Dark background with vivid accent colors. Strong typography area at bottom third for the tagline. No actual text in the image — just leave clean space for text overlay.`;

const DEFAULT_SEED = "amber";

interface CallModelOptions {
  model: string;
  userPrompt: string;
  systemPrompt?: string;
  maxTokens: number;
  apiKey: string;
  timeoutMs?: number;
  modalities?: string[];
}

interface CallModelResult {
  content?: string;
  imageBase64?: string;
  imageMime?: string;
  tokens?: TokenUsage;
  error?: string;
}

async function callModel(opts: CallModelOptions): Promise<CallModelResult> {
  const { model, userPrompt, systemPrompt, maxTokens, apiKey, timeoutMs = 30_000, modalities } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: userPrompt });

    const body: Record<string, unknown> = { model, messages, max_tokens: maxTokens };
    if (modalities) body.modalities = modalities;
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
    const result: CallModelResult = {};

    // Extract token usage
    const usage = data.usage;
    if (usage) {
      result.tokens = {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
      };
    }

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
  const tokenInfo = step.tokens ? ` [${step.tokens.promptTokens}→${step.tokens.completionTokens}t]` : "";
  line += `${icon} **${step.label}**  ${plain(step.model)}  ${step.elapsed}ms${tokenInfo}`;
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

/** Extract STYLE: value from sonnet output */
function extractStyle(sonnetOutput: string): string {
  const match = sonnetOutput.match(/STYLE:\s*(.+)/i);
  return match ? match[1].trim() : "unknown";
}

export async function runHealthCheckWithSeed(
  tg: TelegramClient,
  devTgId: number,
  seed: string,
): Promise<void> {
  return runHealthCheck(tg, devTgId, seed);
}

async function runHealthCheck(
  tg: TelegramClient,
  devTgId: number,
  seed?: string,
): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    await tg.sendText(devTgId, "🧬 Health check\n\n❌ OPENROUTER\_API\_KEY not set");
    return;
  }

  const seedWord = seed || DEFAULT_SEED;
  const steps: ChainStep[] = [];

  // ── Step 1: Haiku — DNA synthesis from seed ───────────────────────────
  const haikuStart = Date.now();
  const haikuResult = await callModel({
    model: resolvedModels.seed,
    systemPrompt: DNA_SYSTEM,
    userPrompt: seedWord,
    maxTokens: 300,
    apiKey,
  });
  const haikuStep: ChainStep = {
    label: "DNA · Haiku",
    model: resolvedModels.seed,
    elapsed: Date.now() - haikuStart,
    tokens: haikuResult.tokens,
    error: haikuResult.error,
    systemPrompt: DNA_SYSTEM,
    input: seedWord,
    output: haikuResult.content,
  };
  steps.push(haikuStep);

  // ── Step 2: Sonnet — consciousness unfolds the DNA ────────────────────
  let sonnetStep: ChainStep;
  if (haikuResult.content) {
    const sonnetStart = Date.now();
    const sonnetResult = await callModel({
      model: resolvedModels.analyze,
      systemPrompt: SONNET_SYSTEM,
      userPrompt: haikuResult.content,
      maxTokens: 600,
      apiKey,
      timeoutMs: 60_000,
    });
    sonnetStep = {
      label: "Unfold · Sonnet",
      model: resolvedModels.analyze,
      elapsed: Date.now() - sonnetStart,
      tokens: sonnetResult.tokens,
      error: sonnetResult.error,
      systemPrompt: SONNET_SYSTEM,
      input: haikuResult.content,
      output: sonnetResult.content,
    };
  } else {
    sonnetStep = {
      label: "Unfold · Sonnet",
      model: resolvedModels.analyze,
      elapsed: 0,
      error: "Skipped — no DNA from Haiku",
    };
  }
  steps.push(sonnetStep);

  // ── Step 3: Nano Banana — manifests the vision ────────────────────────
  let imageStep: ChainStep;
  if (sonnetStep.output) {
    const imagePrompt = NANO_BANANA_MANIFEST.replace("{sonnet_output}", sonnetStep.output);
    const imageStart = Date.now();
    const imageResult = await callModel({
      model: resolvedModels.image,
      userPrompt: imagePrompt,
      maxTokens: 1000,
      apiKey,
      timeoutMs: 60_000,
      modalities: ["image", "text"],
    });
    imageStep = {
      label: "Manifest · Nano Banana",
      model: resolvedModels.image,
      elapsed: Date.now() - imageStart,
      tokens: imageResult.tokens,
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
  const totalTokens = steps.reduce((sum, s) => sum + (s.tokens?.totalTokens ?? 0), 0);
  const allOk = steps.every((s) => !s.error);
  const statusIcon = allOk ? "🧬" : "⚠️";
  const sonnetStyle = sonnetStep.output ? extractStyle(sonnetStep.output) : "—";

  const lines = [
    `${statusIcon} **DNA Chain Health Check**  ${totalElapsed}ms · ${totalTokens} tokens\n`,
    `Seed: **${plain(seedWord)}**  Style: **${plain(sonnetStyle)}**\n`,
    formatChainStep(steps[0]),
    formatChainStep(steps[1], { connector: "  ↓" }),
    formatChainStep(steps[2], { connector: "  ↓" }),
  ];

  const report = lines.join("\n");

  // Store for prompt-view buttons
  lastHealthCheck = { seed: seedWord, steps, sonnetStyle };

  const promptButtons = BotKeyboard.inline([
    [
      BotKeyboard.callback("📋 System", "dev:hc_sys"),
      BotKeyboard.callback("📝 User", "dev:hc_usr"),
    ],
    [
      BotKeyboard.callback("🔬 Haiku out", "dev:hc_haiku"),
      BotKeyboard.callback("🧠 Sonnet out", "dev:hc_sonnet"),
    ],
  ]);

  // Send with image if available
  if (imageStep.imageBase64 && imageStep.imageMime) {
    try {
      const buf = Buffer.from(imageStep.imageBase64, "base64");
      const ext = imageStep.imageMime.split("/")[1] || "png";
      await tg.sendMedia(
        devTgId,
        InputMedia.photo(new Uint8Array(buf), { fileName: `dna-healthcheck.${ext}` }),
        { caption: md(report), replyMarkup: promptButtons },
      );
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await tg.sendText(devTgId, md(`${report}\n\n⚠️ __Failed to attach image: ${md.escape(errMsg.slice(0, 200))}__`), {
        replyMarkup: promptButtons,
      });
    }
  } else {
    await tg.sendText(devTgId, md(report), { replyMarkup: promptButtons });
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
        await cb.answer({ text: "Send seed word (or wait for default)" });
        globalState.devConfigAwait = { type: "text", target: "hc_seed", userId: devTgId };
        await cb.editMessage({
          text: `🧬 DNA Health Check\n\nSend a seed word or tap Run with default ("${DEFAULT_SEED}"):`,
          replyMarkup: BotKeyboard.inline([
            [BotKeyboard.callback(`▶️ Run with "${DEFAULT_SEED}"`, "dev:hc_run_default")],
            [BotKeyboard.callback("← Back", "dev:back")],
          ]),
        });
        break;
      }

      case "hc_run_default": {
        await cb.answer({ text: "Running health check..." });
        globalState.devConfigAwait = null;
        await cb.editMessage({ text: `🧬 Running DNA chain with seed: "${DEFAULT_SEED}"…` });
        await runHealthCheck(tg, devTgId);
        break;
      }

      case "hc_sys": {
        await cb.answer({});
        if (!lastHealthCheck) { await tg.sendText(devTgId, "No health check data."); break; }
        const haikuSys = lastHealthCheck.steps[0]?.systemPrompt ?? "—";
        const sonnetSys = lastHealthCheck.steps[1]?.systemPrompt ?? "—";
        await tg.sendText(devTgId, md`📋 **Haiku system prompt:**\n\n${haikuSys}\n\n📋 **Sonnet system prompt:**\n\n${sonnetSys}`);
        break;
      }

      case "hc_usr": {
        await cb.answer({});
        if (!lastHealthCheck) { await tg.sendText(devTgId, "No health check data."); break; }
        const haikuIn = lastHealthCheck.steps[0]?.input ?? "—";
        const sonnetIn = lastHealthCheck.steps[1]?.input ?? "—";
        await tg.sendText(devTgId, md`📝 **Haiku user input (seed):**\n\n${haikuIn}\n\n📝 **Sonnet user input (haiku output):**\n\n${sonnetIn}`);
        break;
      }

      case "hc_haiku": {
        await cb.answer({});
        if (!lastHealthCheck) { await tg.sendText(devTgId, "No health check data."); break; }
        const out = lastHealthCheck.steps[0]?.output ?? "No output";
        await tg.sendText(devTgId, md`🔬 **Haiku output (DNA traits):**\n\n${out}`);
        break;
      }

      case "hc_sonnet": {
        await cb.answer({});
        if (!lastHealthCheck) { await tg.sendText(devTgId, "No health check data."); break; }
        const out = lastHealthCheck.steps[1]?.output ?? "No output";
        await tg.sendText(devTgId, md`🧠 **Sonnet output:**\n\n${out}`);
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
          text: `👤 User mode active${modeNote}. Send your seed word.`,
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
