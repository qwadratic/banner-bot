import { TelegramClient, BotKeyboard, InputMedia, md } from "@mtcute/node";
import type { CallbackQueryContext } from "@mtcute/dispatcher";
import { CONFIG, resolvedModels } from "../config.js";
import { globalState } from "../session.js";
import { devAlert } from "../devAlert.js";
import { getAdminUserIds, addAdminUserId, removeAdminUserId } from "../runtimeConfig.js";

const startTime = Date.now();

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

function devPanelText(): string {
  const testTag = globalState.testMode ? "  🧪 TEST MODE" : "";
  const session = globalState.activeSession;
  if (session) {
    return (
      `🛠 Dev Panel${testTag}  |  Session: IN_PROGRESS\n` +
      `User: ${session.userId}  Phase: ${session.phase}`
    );
  }
  return `🛠 Dev Panel${testTag}  |  Session: none`;
}

export function devPanelKeyboard() {
  const session = globalState.activeSession;
  const testLabel = globalState.testMode ? "🧪 Test mode: ON" : "🧪 Test mode: OFF";
  const rows = [
    [
      BotKeyboard.callback("📊 Status", "dev:status"),
      BotKeyboard.callback("🔬 Health check", "dev:healthcheck"),
    ],
    [
      BotKeyboard.callback("🔄 Restart", "dev:restart"),
      BotKeyboard.callback("⬇️ Update & restart", "dev:update"),
    ],
    [
      BotKeyboard.callback("⚙️ Config", "cfg:main"),
      BotKeyboard.callback(testLabel, "dev:testmode"),
    ],
    [BotKeyboard.callback("👥 Admins", "dev:admins")],
  ];

  if (!session) {
    rows.push([BotKeyboard.callback("👤 User mode", "dev:usermode")]);
  }

  return BotKeyboard.inline(rows);
}

function backKeyboard() {
  return BotKeyboard.inline([
    [BotKeyboard.callback("← Back", "dev:back")],
  ]);
}

function statusText(): string {
  const uptime = formatUptime(Date.now() - startTime);

  const envVars: Array<{ name: string; value: string | undefined }> = [
    { name: "BOT_TOKEN", value: process.env.BOT_TOKEN },
    { name: "OPENROUTER_API_KEY", value: process.env.OPENROUTER_API_KEY },
    { name: "ADMIN_USER_IDS", value: process.env.ADMIN_USER_IDS },
    { name: "DEV_TG_ID", value: process.env.DEV_TG_ID },
  ];

  const modelVars: Array<{
    name: string;
    envKey: string;
    envValue: string | undefined;
    configKey: keyof typeof CONFIG.models;
  }> = [
    {
      name: "MODEL_GATE",
      envKey: "MODEL_GATE",
      envValue: process.env.MODEL_GATE,
      configKey: "gate",
    },
    {
      name: "MODEL_ANALYZE",
      envKey: "MODEL_ANALYZE",
      envValue: process.env.MODEL_ANALYZE,
      configKey: "analyze",
    },
    {
      name: "MODEL_IMAGE",
      envKey: "MODEL_IMAGE",
      envValue: process.env.MODEL_IMAGE,
      configKey: "image",
    },
  ];

  let text = `📊 Status\n\n`;
  text += `Uptime: ${uptime}\n`;
  text += `Node: ${process.version}\n`;
  text += `PID: ${process.pid}\n\n`;
  text += `Env vars:\n`;

  for (const v of envVars) {
    const icon = v.value ? "✅" : "⬜";
    text += `  ${v.name.padEnd(20)} ${icon}\n`;
  }

  for (const v of modelVars) {
    const isOverride = !!v.envValue;
    const icon = isOverride ? "✅" : "⬜";
    const slug = isOverride ? v.envValue : CONFIG.models[v.configKey];
    const source = isOverride ? "(override)" : "(config default)";
    text += `  ${v.name.padEnd(20)} ${icon}  ${slug}  ${source}\n`;
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
  output?: string;
  imageBase64?: string;
  imageMime?: string;
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

function formatChainStep(step: ChainStep, connector?: string): string {
  const icon = step.error ? "❌" : "✅";
  let line = connector ? `${connector}\n` : "";
  line += `${icon} **${step.label}**  ${plain(step.model)}  ${step.elapsed}ms`;
  if (step.error) {
    line += `\n    ${plain(step.error.slice(0, 600))}`;
  }
  if (step.output) {
    line += `\n    → ${plain(step.output.slice(0, 300))}`;
  }
  if (step.imageBase64) {
    const kb = Math.round(step.imageBase64.length * 0.75 / 1024);
    line += `\n    → image ${step.imageMime} ${kb} KB`;
  }
  return line;
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

  const steps: ChainStep[] = [];

  // ── Step 1: Haiku — the DNA seed ──────────────────────────────────────
  const haikuStart = Date.now();
  const haikuResult = await callModel(resolvedModels.gate, DNA_SEED, 150, apiKey);
  const haikuStep: ChainStep = {
    label: "DNA · Haiku",
    model: resolvedModels.gate,
    elapsed: Date.now() - haikuStart,
    error: haikuResult.error,
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
    formatChainStep(steps[0]),
    formatChainStep(steps[1], "  ↓"),
    formatChainStep(steps[2], "  ↓"),
  ];

  const report = lines.join("\n");

  // Send with image if available
  if (imageStep.imageBase64 && imageStep.imageMime) {
    try {
      const buf = Buffer.from(imageStep.imageBase64, "base64");
      const ext = imageStep.imageMime.split("/")[1] || "png";
      await tg.sendMedia(
        devTgId,
        InputMedia.photo(new Uint8Array(buf), { fileName: `dna-healthcheck.${ext}` }),
        { caption: md(report) },
      );
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await tg.sendText(devTgId, md(`${report}\n\n⚠️ __Failed to attach image: ${md.escape(errMsg.slice(0, 200))}__`));
    }
  } else {
    await tg.sendText(devTgId, md(report));
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

export async function handleDevCallback(tg: TelegramClient, cb: CallbackQueryContext, devTgId: number): Promise<void> {
  const data = cb.dataStr;
  if (!data?.startsWith("dev:")) {
    await cb.answer({});
    return;
  }

  const action = data.slice(4);

  try {
    switch (action) {
      case "status": {
        await cb.answer({});
        await cb.editMessage({
          text: statusText(),
          replyMarkup: backKeyboard(),
        });
        break;
      }

      case "healthcheck": {
        await cb.answer({ text: "Running health checks..." });
        await runHealthCheck(tg, devTgId);
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

      case "testmode": {
        globalState.testMode = !globalState.testMode;
        await cb.answer({ text: globalState.testMode ? "Test mode ON — API calls are mocked" : "Test mode OFF — real API calls" });
        await cb.editMessage({
          text: devPanelText(),
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
        const modeNote = globalState.testMode ? " (🧪 test mode)" : "";
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
          text: devPanelText(),
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
