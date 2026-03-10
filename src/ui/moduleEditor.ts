import { BotKeyboard } from "@mtcute/node";
import type { ReplyMarkup } from "@mtcute/node";
import { getModuleOptions } from "../runtimeConfig.js";
import type { Session, ModuleSet } from "../session.js";

export function moduleEditorText(session: Session): string {
  const effective = getEffectiveModules(session);
  if (!effective) return "⚙️ Налаштування модулів\n\n(немає даних)";

  let text = "⚙️ Налаштування модулів\n\nОберіть категорію для зміни:";
  for (const [key, val] of Object.entries(effective)) {
    const overridden = key in session.userOverrides ? " ✏️" : "";
    text += `\n• ${key} = ${val}${overridden}`;
  }
  return text;
}

export function moduleEditorKeyboard(session: Session): ReplyMarkup {
  const categories = Object.keys(getModuleOptions());
  const rows = categories.map((cat) => [
    BotKeyboard.callback(`⚙️ ${cat}`, `module_cat:${cat}`),
  ]);
  rows.push([
    BotKeyboard.callback("✅ Готово — Генерувати", "modules:done"),
    BotKeyboard.callback("↩️ Назад", "modules:back"),
  ]);
  return BotKeyboard.inline(rows);
}

export function moduleCategoryKeyboard(category: string, session: Session): ReplyMarkup {
  const options = getModuleOptions()[category] ?? [];
  const effective = getEffectiveModules(session);
  const current = effective ? effective[category as keyof ModuleSet] : null;

  // 2-3 buttons per row
  const rows: ReturnType<typeof BotKeyboard.callback>[][] = [];
  let currentRow: ReturnType<typeof BotKeyboard.callback>[] = [];

  for (const opt of options) {
    const selected = opt === current;
    const label = selected ? `✓ ${opt}` : opt;
    currentRow.push(BotKeyboard.callback(label, `module:${category}:${opt}`));
    if (currentRow.length >= 3) {
      rows.push(currentRow);
      currentRow = [];
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  rows.push([BotKeyboard.callback("↩️ Назад до модулів", "modules:edit")]);
  return BotKeyboard.inline(rows);
}

function getEffectiveModules(session: Session): ModuleSet | null {
  if (!session.modules) return null;
  return { ...session.modules, ...session.userOverrides } as ModuleSet;
}
