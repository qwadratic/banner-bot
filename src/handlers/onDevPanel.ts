import { TelegramClient, BotKeyboard, InputMedia, md } from "@mtcute/node";
import type { CallbackQueryContext } from "@mtcute/dispatcher";
import { CONFIG, resolvedModels } from "../config.js";
import { globalState } from "../session.js";
import { devAlert } from "../devAlert.js";

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

interface ModelCheck {
  label: string;
  model: string;
  prompt: string;
  maxTokens: number;
}

interface CheckResult {
  label: string;
  model: string;
  elapsed: number;
  error?: string;
  rawContent?: string;        // text content from response
  imageBase64?: string;       // base64 image data (no prefix)
  imageMime?: string;
  messageKeys?: string[];     // keys present on the message object
}

const HEALTHCHECK_MODELS: ModelCheck[] = [
  { label: "Gate", model: resolvedModels.gate, prompt: 'Tell me a mass-appeal one-liner joke. Max 15 words.', maxTokens: 60 },
  { label: "Analyze", model: resolvedModels.analyze, prompt: "Reply with the single word: READY", maxTokens: 50 },
  { label: "Image", model: resolvedModels.image, prompt: "A solid dark green rectangle, no text.", maxTokens: 1000 },
];

async function probeModel(check: ModelCheck, apiKey: string): Promise<CheckResult> {
  const { label, model, prompt, maxTokens } = check;
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const elapsed = Date.now() - start;

    if (!resp.ok) {
      const body = await resp.text();
      return { label, model, elapsed, error: `HTTP ${resp.status}: ${body.slice(0, 500)}` };
    }

    const rawBody = await resp.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = JSON.parse(rawBody) as any;

    if (data.error) {
      return { label, model, elapsed, error: `API: ${data.error.message ?? JSON.stringify(data.error)}` };
    }

    const message = data.choices?.[0]?.message;
    const result: CheckResult = { label, model, elapsed, messageKeys: Object.keys(message ?? {}) };

    // Extract text content as-is
    const content = message?.content;
    if (typeof content === "string" && content.length > 0) {
      result.rawContent = content;
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

    // If we got nothing at all, dump the message object for debugging
    if (!result.rawContent && !result.imageBase64) {
      const msgDump = JSON.stringify(message, (_k, v) => {
        // Truncate long encrypted/base64 blobs
        if (typeof v === "string" && v.length > 200) return v.slice(0, 200) + "...";
        return v;
      });
      result.error = `No content or image. Raw message: ${msgDump}`;
    }

    return result;
  } catch (err) {
    const elapsed = Date.now() - start;
    const msg = err instanceof Error && err.name === "AbortError"
      ? "Timed out (30s)"
      : err instanceof Error ? err.message : String(err);
    return { label, model, elapsed, error: msg };
  }
}

/** Sanitize a string so it renders as plain text inside md() */
function plain(s: string): string {
  return md.escape(s).replace(/`/g, "'");
}

function formatCheckResult(r: CheckResult): string {
  const icon = r.error ? "❌" : "✅";
  let line = `${icon} **${r.label}**  ${plain(r.model)}  ${r.elapsed}ms`;
  if (r.error) {
    line += `\n  ${plain(r.error.slice(0, 800))}`;
  }
  if (r.rawContent != null) {
    line += `\n  → ${plain(r.rawContent.slice(0, 200))}`;
  }
  if (r.imageBase64) {
    const kb = Math.round(r.imageBase64.length * 0.75 / 1024);
    line += `\n  → image ${r.imageMime} ${kb} KB`;
  }
  return line;
}

async function runHealthCheck(
  tg: TelegramClient,
  devTgId: number,
): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    await tg.sendText(devTgId, "🔬 Health check\n\n❌ OPENROUTER\_API\_KEY not set");
    return;
  }

  // Fire all probes in parallel, wait for all
  const results = await Promise.all(
    HEALTHCHECK_MODELS.map((c) => probeModel(c, apiKey)),
  );

  // Build report text
  const lines = ["🔬 **Health check**\n"];
  for (const r of results) {
    lines.push(formatCheckResult(r));
  }
  const report = lines.join("\n");

  // Find the first image result (if any) to attach to the report
  const imgResult = results.find((r) => r.imageBase64 && r.imageMime);

  if (imgResult?.imageBase64 && imgResult.imageMime) {
    // Send as photo with the full report as caption
    try {
      const buf = Buffer.from(imgResult.imageBase64, "base64");
      const ext = imgResult.imageMime.split("/")[1] || "png";
      await tg.sendMedia(
        devTgId,
        InputMedia.photo(new Uint8Array(buf), { fileName: `healthcheck.${ext}` }),
        { caption: md(report) },
      );
    } catch (e) {
      // If photo send fails, fall back to text-only
      const errMsg = e instanceof Error ? e.message : String(e);
      await tg.sendText(devTgId, md(`${report}\n\n⚠️ __Failed to attach image: ${md.escape(errMsg.slice(0, 200))}__`));
    }
  } else {
    // No image — send text-only
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

      case "back": {
        await cb.answer({});
        await cb.editMessage({
          text: devPanelText(),
          replyMarkup: devPanelKeyboard(),
        });
        break;
      }

      default: {
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
