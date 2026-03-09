import { TelegramClient, BotKeyboard } from "@mtcute/node";
import { Dispatcher, filters } from "@mtcute/dispatcher";
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
  const session = globalState.activeSession;
  if (session) {
    return (
      `🛠 Dev Panel  |  Session: IN_PROGRESS\n` +
      `User: ${session.userId}  Phase: ${session.phase}`
    );
  }
  return `🛠 Dev Panel  |  Session: none`;
}

function devPanelKeyboard() {
  const session = globalState.activeSession;
  const rows = [
    [
      BotKeyboard.callback("📊 Status", "dev:status"),
      BotKeyboard.callback("🔬 Health check", "dev:healthcheck"),
    ],
    [
      BotKeyboard.callback("🔄 Restart", "dev:restart"),
      BotKeyboard.callback("⬇️ Update & restart", "dev:update"),
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

async function runHealthCheck(): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return "🔬 Health check\n\n❌ OPENROUTER_API_KEY not set";
  }

  const checks = await Promise.allSettled([
    checkTextModel(
      "Gate",
      resolvedModels.gate,
      'Reply with valid JSON: {"ok": true}',
      apiKey,
      (text) => {
        try {
          const json = JSON.parse(text);
          return json.ok === true;
        } catch {
          return false;
        }
      },
    ),
    checkTextModel(
      "Analyze",
      resolvedModels.analyze,
      "Reply with the single word: READY",
      apiKey,
      (text) => text.includes("READY"),
    ),
    checkImageModel(
      "Image",
      resolvedModels.image,
      "A solid dark green rectangle, no text.",
      apiKey,
    ),
  ]);

  let text = "🔬 Health check\n";

  for (const result of checks) {
    if (result.status === "fulfilled") {
      text += `\n${result.value}`;
    } else {
      text += `\n❌ Unexpected error: ${result.reason}`;
    }
  }

  return text;
}

async function checkTextModel(
  label: string,
  model: string,
  prompt: string,
  apiKey: string,
  validate: (text: string) => boolean,
): Promise<string> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 50,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const elapsed = Date.now() - start;

    if (!resp.ok) {
      const body = await resp.text();
      return `${label}    ${model}\n❌ FAILED — ${elapsed}ms\nError: HTTP ${resp.status}: ${body}`;
    }

    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";

    if (validate(content)) {
      return `${label}    ${model}\n✅ OK — ${elapsed}ms`;
    } else {
      return `${label}    ${model}\n❌ FAILED — ${elapsed}ms\nError: Unexpected response: ${content.slice(0, 200)}`;
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? "Request timed out"
        : err instanceof Error
          ? err.message
          : String(err);
    return `${label}    ${model}\n❌ FAILED — ${elapsed}ms\nError: ${msg}`;
  }
}

async function checkImageModel(
  label: string,
  model: string,
  prompt: string,
  apiKey: string,
): Promise<string> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const elapsed = Date.now() - start;

    if (!resp.ok) {
      const body = await resp.text();
      return `${label}    ${model}\n❌ FAILED — ${elapsed}ms\nError: HTTP ${resp.status}: ${body}`;
    }

    const data = (await resp.json()) as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type: string; image_url?: { url?: string } }>;
        };
      }>;
    };
    const content = data.choices?.[0]?.message?.content;

    // Check if we got any non-empty response (image data may come in various formats)
    const hasContent =
      content != null &&
      (typeof content === "string"
        ? content.length > 0
        : Array.isArray(content) && content.length > 0);

    if (hasContent) {
      return `${label}    ${model}\n✅ OK — ${elapsed}ms`;
    } else {
      return `${label}    ${model}\n❌ FAILED — ${elapsed}ms\nError: Empty response`;
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? "Request timed out"
        : err instanceof Error
          ? err.message
          : String(err);
    return `${label}    ${model}\n❌ FAILED — ${elapsed}ms\nError: ${msg}`;
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

export function registerDevPanel(
  tg: TelegramClient,
  dp: Dispatcher,
  devTgId: number,
): void {
  // Handle all messages from dev user
  dp.onNewMessage(filters.userId(devTgId), async (msg) => {
    // If dev is in user mode with an active session, let message through
    if (
      globalState.devUserMode &&
      globalState.activeSession?.userId === devTgId
    ) {
      return;
    }

    // Show dev panel
    await msg.answerText(devPanelText(), {
      replyMarkup: devPanelKeyboard(),
    });
  });

  // Handle callback queries from dev user
  dp.onCallbackQuery(filters.userId(devTgId), async (cb) => {
    const data = cb.dataStr;
    if (!data?.startsWith("dev:")) {
      // If dev is in user mode, let callback through
      if (
        globalState.devUserMode &&
        globalState.activeSession?.userId === devTgId
      ) {
        return;
      }
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
          const result = await runHealthCheck();
          // Send as new message so it persists in chat history
          await tg.sendText(devTgId, result);
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

        case "usermode": {
          if (globalState.activeSession) {
            await cb.answer({
              text: "A session is already active",
            });
            return;
          }

          await cb.answer({});
          globalState.devUserMode = true;
          await cb.editMessage({
            text: "👤 User mode active. Send your funnel message.",
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
  });
}
