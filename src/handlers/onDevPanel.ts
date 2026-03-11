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
  const testLabel = globalState.testMode ? "🧪 UI Test: ON" : "🧪 UI Test: OFF";
  const rows = [
    [
      BotKeyboard.callback("🔬 Model Test", "dev:modeltest"),
      BotKeyboard.callback("👤 Enter User Mode", "dev:usermode"),
    ],
    [
      BotKeyboard.callback(testLabel, "dev:uitest"),
      BotKeyboard.callback("📊 Sessions", "dev:sessions"),
    ],
    [
      BotKeyboard.callback("⚙️ Config", "cfg:main"),
      BotKeyboard.callback("⬇️ Update", "dev:update"),
    ],
    [BotKeyboard.callback("🔄 Reboot", "dev:restart")],
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
