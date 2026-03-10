import { BotKeyboard } from "@mtcute/node";
import type { ReplyMarkup } from "@mtcute/node";
import { CONFIG } from "../config.js";
import type { Session } from "../session.js";

export function hintSelectorText(): string {
  return (
    "✅ Повідомлення воронки розпізнано.\n\n" +
    "Додайте підказки для аналізу (необов'язково):"
  );
}

export function hintSelectorKeyboard(session: Session): ReplyMarkup {
  const stageHints = CONFIG.hints.stage;
  const styleHints = CONFIG.hints.style;

  // Stage buttons — 2 rows of 4
  const stageRow1 = stageHints.slice(0, 4).map((h) => {
    const selected = session.selectedHints.stage === h.value;
    const label = selected ? `✓ ${h.label}` : h.label;
    return BotKeyboard.callback(label, `hint_stage:${h.value}`);
  });
  const stageRow2 = stageHints.slice(4).map((h) => {
    const selected = session.selectedHints.stage === h.value;
    const label = selected ? `✓ ${h.label}` : h.label;
    return BotKeyboard.callback(label, `hint_stage:${h.value}`);
  });

  // Style buttons — 1 row
  const styleRow1 = styleHints.slice(0, 3).map((h) => {
    const selected = session.selectedHints.style === h.value;
    const label = selected ? `✓ ${h.label}` : h.label;
    return BotKeyboard.callback(label, `hint_style:${h.value}`);
  });
  const styleRow2 = styleHints.slice(3).map((h) => {
    const selected = session.selectedHints.style === h.value;
    const label = selected ? `✓ ${h.label}` : h.label;
    return BotKeyboard.callback(label, `hint_style:${h.value}`);
  });

  const actionRow = [
    BotKeyboard.callback("✅ Аналізувати", "hints:confirm"),
    BotKeyboard.callback("⏭ Пропустити підказки", "hints:skip"),
  ];

  return BotKeyboard.inline([stageRow1, stageRow2, styleRow1, styleRow2, actionRow]);
}
