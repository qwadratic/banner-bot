import { BotKeyboard } from "@mtcute/node";
import type { ReplyMarkup } from "@mtcute/node";
import type { Session } from "../session.js";

const CONFIDENCE_LABELS: Record<string, string> = {
  high: "висока",
  medium: "середня",
  low: "низька",
};

export function analysisCardText(session: Session): string {
  const stage = session.detectedStage ?? "—";
  const conf = session.stageConfidence
    ? CONFIDENCE_LABELS[session.stageConfidence] ?? session.stageConfidence
    : "—";

  let text = `📊 Аналіз\n\nЕтап: ${stage}  (впевненість: ${conf})`;

  // Hint agreement line
  if (session.selectedHints.stage) {
    if (session.modelAgreesWithHint === true || session.modelAgreesWithHint === null) {
      text += `\n↳ Ваша підказка: "${session.selectedHints.stage}" — погоджуюсь ✓`;
    } else if (session.modelAgreesWithHint === false) {
      text += `\n↳ Ваша підказка: "${session.selectedHints.stage}" — пропоную ${stage}.`;
      if (session.disagreementReason) {
        text += `\n  ${session.disagreementReason}`;
      }
    }
  }

  // Modules
  const effective = session.modules
    ? { ...session.modules, ...session.userOverrides }
    : null;
  if (effective) {
    text += "\n\nМодулі:";
    for (const [key, val] of Object.entries(effective)) {
      text += `\n• ${key.padEnd(16)} = ${val}`;
    }
  }

  return text;
}

export function analysisCardKeyboard(session: Session): ReplyMarkup {
  // Check if model disagrees with user hint
  if (
    session.modelAgreesWithHint === false &&
    session.selectedHints.stage &&
    session.detectedStage !== session.selectedHints.stage
  ) {
    return BotKeyboard.inline([
      [
        BotKeyboard.callback(`✅ Використати ${session.detectedStage}`, "stage:use_model"),
        BotKeyboard.callback(`🔁 Залишити ${session.selectedHints.stage}`, "stage:keep_user"),
      ],
      [
        BotKeyboard.callback("⚙️ Налаштувати модулі", "modules:edit"),
        BotKeyboard.callback("❌ Скасувати", "session:end"),
      ],
    ]);
  }

  // Normal case: agrees or no hint
  return BotKeyboard.inline([
    [
      BotKeyboard.callback("✅ Генерувати банер", "generate:confirm"),
      BotKeyboard.callback("🔄 Змінити етап", "stage:pick"),
    ],
    [
      BotKeyboard.callback("⚙️ Налаштувати модулі", "modules:edit"),
      BotKeyboard.callback("❌ Скасувати", "session:end"),
    ],
  ]);
}

export function stagePickerKeyboard(): ReplyMarkup {
  const stages = [
    "Attention", "Identification", "Problem", "Insight",
    "Authority", "Micro-value", "Possibility", "FOMO",
  ];
  const row1 = stages.slice(0, 4).map((s) =>
    BotKeyboard.callback(s, `stage:set:${s}`),
  );
  const row2 = stages.slice(4).map((s) =>
    BotKeyboard.callback(s, `stage:set:${s}`),
  );
  return BotKeyboard.inline([row1, row2]);
}
