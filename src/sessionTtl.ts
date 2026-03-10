import type { TelegramClient } from "@mtcute/node";
import { CONFIG } from "./config.js";
import { globalState } from "./session.js";
import { devAlert } from "./devAlert.js";

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startSessionTtl(tg: TelegramClient): void {
  if (intervalId) return;

  intervalId = setInterval(() => {
    checkSessionTtl(tg).catch((err) => {
      devAlert("sessionTtl / check", err).catch(() => {});
    });
  }, 30_000);
}

export function stopSessionTtl(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

async function checkSessionTtl(tg: TelegramClient): Promise<void> {
  const session = globalState.activeSession;
  if (!session) return;

  const elapsed = Date.now() - session.lastActivityAt;

  if (elapsed >= CONFIG.timeouts.sessionExpireAt) {
    // Session expired
    const snapshot = {
      userId: session.userId,
      sessionId: session.sessionId,
      phase: session.phase,
      elapsed,
    };

    globalState.activeSession = null;

    await devAlert("session auto-expired", "Session expired due to inactivity", snapshot);

    try {
      await tg.sendText(session.userId, CONFIG.ui.sessionExpired);
    } catch {
      // ignore send failures
    }
  } else if (elapsed >= CONFIG.timeouts.sessionWarnAt && !session.warningSent) {
    // Send warning
    session.warningSent = true;
    try {
      await tg.sendText(session.userId, CONFIG.ui.sessionWarn);
    } catch {
      // ignore
    }
  }
}
