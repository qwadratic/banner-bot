import { TelegramClient, BotKeyboard } from "@mtcute/node";
import { Dispatcher, filters } from "@mtcute/dispatcher";
import { globalState } from "../session.js";

function userWelcomeKeyboard() {
  return BotKeyboard.inline([
    [
      BotKeyboard.callback("🎨 Create banner", "user:create"),
      BotKeyboard.callback("🖼 My banners", "user:list"),
    ],
    [
      BotKeyboard.callback("ℹ️ Help", "user:help"),
      BotKeyboard.callback("⚙️ Settings", "user:settings"),
    ],
  ]);
}

function bannerStyleKeyboard() {
  return BotKeyboard.inline([
    [
      BotKeyboard.callback("🌄 Landscape", "user:style:landscape"),
      BotKeyboard.callback("🏙 Portrait", "user:style:portrait"),
    ],
    [
      BotKeyboard.callback("⬜ Square", "user:style:square"),
      BotKeyboard.callback("📐 Custom", "user:style:custom"),
    ],
    [BotKeyboard.callback("← Back", "user:back")],
  ]);
}

function confirmKeyboard(action: string) {
  return BotKeyboard.inline([
    [
      BotKeyboard.callback("✅ Confirm", `user:confirm:${action}`),
      BotKeyboard.callback("❌ Cancel", "user:back"),
    ],
  ]);
}

function backKeyboard() {
  return BotKeyboard.inline([
    [BotKeyboard.callback("← Back to menu", "user:back")],
  ]);
}

export function registerUserHandler(
  tg: TelegramClient,
  dp: Dispatcher,
  devTgId: number,
): void {
  // Handle messages from non-dev users (or dev in user mode)
  dp.onNewMessage(
    filters.not(filters.userId(devTgId)),
    async (msg) => {
      const userId = msg.sender?.id;
      if (!userId) return;

      // If there's an active session for this user, let the session handler deal with it
      if (
        globalState.activeSession &&
        globalState.activeSession.userId === userId
      ) {
        return;
      }

      await msg.answerText(
        `👋 Welcome to Banner Bot!\n\nChoose an action below:`,
        { replyMarkup: userWelcomeKeyboard() },
      );
    },
  );

  // Handle inline button callbacks from non-dev users
  dp.onCallbackQuery(
    filters.not(filters.userId(devTgId)),
    async (cb) => {
      const data = cb.dataStr;
      if (!data?.startsWith("user:")) {
        await cb.answer({});
        return;
      }

      const action = data.slice(5); // strip "user:"

      try {
        switch (action) {
          case "create": {
            await cb.answer({});
            await cb.editMessage({
              text: "🎨 Create a new banner\n\nChoose a style:",
              replyMarkup: bannerStyleKeyboard(),
            });
            break;
          }

          case "list": {
            await cb.answer({});
            await cb.editMessage({
              text: "🖼 My banners\n\nYou have no banners yet. Create one to get started!",
              replyMarkup: backKeyboard(),
            });
            break;
          }

          case "help": {
            await cb.answer({});
            await cb.editMessage({
              text:
                "ℹ️ Help\n\n" +
                "Banner Bot creates custom banners using AI.\n\n" +
                "1. Tap 🎨 Create banner\n" +
                "2. Choose a style\n" +
                "3. Describe what you want\n" +
                "4. Get your banner!\n\n" +
                "Send any message to start over.",
              replyMarkup: backKeyboard(),
            });
            break;
          }

          case "settings": {
            await cb.answer({});
            await cb.editMessage({
              text: "⚙️ Settings\n\nNo configurable settings yet.",
              replyMarkup: backKeyboard(),
            });
            break;
          }

          case "style:landscape":
          case "style:portrait":
          case "style:square":
          case "style:custom": {
            const style = action.split(":")[1];
            await cb.answer({});
            await cb.editMessage({
              text: `📐 Style: ${style}\n\nNow send me a description of your banner.`,
              replyMarkup: confirmKeyboard(style),
            });
            break;
          }

          case "back": {
            await cb.answer({});
            await cb.editMessage({
              text: `👋 Welcome to Banner Bot!\n\nChoose an action below:`,
              replyMarkup: userWelcomeKeyboard(),
            });
            break;
          }

          default: {
            if (action.startsWith("confirm:")) {
              const style = action.slice(8);
              await cb.answer({ text: `Creating ${style} banner...` });
              await cb.editMessage({
                text: `⏳ Generating your ${style} banner...\n\nThis may take a moment.`,
              });
              // TODO: integrate with AI image generation
              break;
            }
            await cb.answer({ text: "Unknown action" });
          }
        }
      } catch (err) {
        console.error(`[user handler] callback error:`, err);
        try {
          await cb.answer({ text: "Something went wrong" });
        } catch {
          // ignore
        }
      }
    },
  );
}
