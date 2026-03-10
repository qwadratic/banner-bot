import { BotKeyboard } from "@mtcute/node";
import type { ReplyMarkup } from "@mtcute/node";
import { getEffectiveModules } from "../session.js";
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
  const effective = getEffectiveModules(session);
  if (effective) {
    text += "\n\nМодулі:";
    for (const [key, val] of Object.entries(effective)) {
      text += `\n• ${key.padEnd(16)} = ${val}`;
    }
  }

  return text;
}

export function analysisCardKeyboard(session: Session): ReplyMarkup {
  // Disagreement case: model suggests different stage than user hint
  if (
    session.modelAgreesWithHint === false &&
    session.selectedHints.stage &&
    session.detectedStage !== session.selectedHints.stage
  ) {
    return BotKeyboard.inline([
      [BotKeyboard.callback(`✅ Погодитись з AI`, "stage:use_model")],
      [BotKeyboard.callback(`🔁 Залишити мій вибір`, "stage:keep_user")],
      [BotKeyboard.callback("❌ Скасувати", "session:end")],
    ]);
  }

  // Normal case: agrees or no hint
  return BotKeyboard.inline([
    [BotKeyboard.callback("✅ Генерувати банер", "generate:confirm")],
    [BotKeyboard.callback("❌ Скасувати", "session:end")],
  ]);
}
