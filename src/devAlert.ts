import { TelegramClient } from "@mtcute/node";

let tg: TelegramClient | null = null;
let devTgId: number | null = null;

export function initDevAlert(client: TelegramClient, devId: number): void {
  tg = client;
  devTgId = devId;
}

export async function devAlert(
  context: string,
  error: unknown,
  extra?: object,
): Promise<void> {
  try {
    if (!tg || !devTgId) {
      console.error(`[devAlert] Not initialized. Context: ${context}`, error);
      return;
    }

    const errorMsg =
      error instanceof Error ? error.message : String(error);
    const stack =
      error instanceof Error && error.stack ? `\n${error.stack}` : "";

    let text = `🚨 ${context}\n\n${errorMsg}${stack}`;

    if (extra) {
      text += `\n\n${JSON.stringify(extra, null, 2)}`;
    }

    text += `\n\n${new Date().toISOString()}`;

    // Telegram message limit is 4096 chars
    if (text.length > 4096) {
      text = text.slice(0, 4093) + "...";
    }

    await tg.sendText(devTgId, text);
  } catch (sendError) {
    console.error("[devAlert] Failed to send alert:", sendError);
    console.error("[devAlert] Original error:", context, error);
  }
}
