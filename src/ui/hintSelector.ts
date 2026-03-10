import { BotKeyboard } from "@mtcute/node";
import type { ReplyMarkup } from "@mtcute/node";
import { CONFIG } from "../config.js";
import type { Session } from "../session.js";

// ── Stage descriptions (shown when a stage is selected) ─────────────────

const STAGE_DESCRIPTIONS: Record<string, string> = {
  Attention:
    "Привертає увагу контрастом і яскравими візуальними елементами. Для холодної аудиторії, яка ще не знає вас.",
  Identification:
    "Створює впізнавання: «це про мене». Цитати та зрозумілі візуальні образи.",
  Problem:
    "Підсвічує біль і симптоми. Драматичні візуальні порівняння та діагностика.",
  Insight:
    "Навчає через медичні деталі. Діаграми, пояснення, аналітичні візуали.",
  Authority:
    "Будує довіру через експертність. Фото лікаря, професійний авторитет.",
  "Micro-value":
    "Дає швидку корисну пораду. Збільшені деталі, ефект відкриття.",
  Possibility:
    "Показує трансформацію і результат. Символічні, натхненні образи.",
  FOMO:
    "Створює терміновість і дефіцит. Таймери, сильний контраст, заклик до дії.",
};

// ── Style descriptions ──────────────────────────────────────────────────

const STYLE_DESCRIPTIONS: Record<string, string> = {
  minimal:
    "Чистий, просторий макет з мінімумом елементів. Акцент на тексті.",
  aggressive:
    "Яскраві кольори, великий текст, максимальний контраст. Кричущий банер.",
  educational:
    "Фокус на діаграмах та інфографіці. Інформативний, серйозний макет.",
  "scroll-stop":
    "Несподіваний візуальний елемент, що зупиняє скролінг. Парадокс або контраст.",
  standard:
    "Збалансований професійний медичний маркетинг. Класичний підхід.",
};

// ── Step 1: Stage selection ─────────────────────────────────────────────

export function stageStepText(session: Session): string {
  let text =
    "🎯 Крок 1/2 — Етап воронки\n\n" +
    "Оберіть психологічний етап вашого повідомлення.\n" +
    "Це визначає візуальну стратегію банера — які елементи, емоції та прийоми будуть використані.";

  const selected = session.selectedHints.stage;
  if (selected && STAGE_DESCRIPTIONS[selected]) {
    text += `\n\n✓ ${selected}\n${STAGE_DESCRIPTIONS[selected]}`;
  }

  return text;
}

export function stageStepKeyboard(session: Session): ReplyMarkup {
  const stageHints = CONFIG.hints.stage;
  const hasSelection = !!session.selectedHints.stage;

  // 2 buttons per row for full label visibility
  const rows: ReturnType<typeof BotKeyboard.callback>[][] = [];
  for (let i = 0; i < stageHints.length; i += 2) {
    rows.push(
      stageHints.slice(i, i + 2).map((h) => {
        const selected = session.selectedHints.stage === h.value;
        const label = selected ? `✓ ${h.label}` : h.label;
        return BotKeyboard.callback(label, `hint_stage:${h.value}`);
      }),
    );
  }

  // Show "Далі →" when something is selected, otherwise "Пропустити"
  const actionRow = hasSelection
    ? [BotKeyboard.callback("Далі →", "hints:next")]
    : [BotKeyboard.callback("⏭ Пропустити (без підказки)", "hints:skip_stage")];

  return BotKeyboard.inline([...rows, actionRow]);
}

// ── Step 2: Style selection ─────────────────────────────────────────────

export function styleStepText(session: Session): string {
  let text =
    "🎨 Крок 2/2 — Стиль банера\n\n" +
    "Оберіть візуальний стиль.\n" +
    "Це впливає на загальний вигляд: кольори, контраст, композицію.";

  const selected = session.selectedHints.style;
  if (selected && STYLE_DESCRIPTIONS[selected]) {
    const styleLabel = CONFIG.hints.style.find((s) => s.value === selected)?.label ?? selected;
    text += `\n\n✓ ${styleLabel}\n${STYLE_DESCRIPTIONS[selected]}`;
  }

  // Show stage selection from step 1 if present
  if (session.selectedHints.stage) {
    text += `\n\n↳ Етап: ${session.selectedHints.stage}`;
  }

  return text;
}

export function styleStepKeyboard(session: Session): ReplyMarkup {
  const styleHints = CONFIG.hints.style;
  const hasSelection = !!session.selectedHints.style;

  // 2 buttons per row for full label visibility
  const rows: ReturnType<typeof BotKeyboard.callback>[][] = [];
  for (let i = 0; i < styleHints.length; i += 2) {
    rows.push(
      styleHints.slice(i, i + 2).map((h) => {
        const selected = session.selectedHints.style === h.value;
        const label = selected ? `✓ ${h.label}` : h.label;
        return BotKeyboard.callback(label, `hint_style:${h.value}`);
      }),
    );
  }

  // Show "Аналізувати" when something is selected, otherwise "Пропустити"
  const actionRow = hasSelection
    ? [BotKeyboard.callback("✅ Аналізувати", "hints:confirm")]
    : [BotKeyboard.callback("⏭ Пропустити (без підказки)", "hints:skip_style")];

  return BotKeyboard.inline([...rows, actionRow]);
}
