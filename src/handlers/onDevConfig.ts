import * as fs from "node:fs";
import * as path from "node:path";
import { TelegramClient, BotKeyboard, InputMedia } from "@mtcute/node";
import type { CallbackQueryContext, MessageContext } from "@mtcute/dispatcher";
import { CONFIG } from "../config.js";
import { globalState } from "../session.js";
import { devAlert } from "../devAlert.js";
import {
  getHaikuPrompt, getSonnetPrompt, getImageTemplate,
  getDoctorPortrait, getBannerStyles,
  getStageModuleDefaults, getModuleOptions,
  setHaikuPrompt, setSonnetPrompt, setImageTemplate,
  setDoctorPortrait, setDoctorAnnotation, deleteDoctorPortrait,
  setBannerStyle, setBannerAnnotation, deleteBannerStyle,
  setStageModuleDefault, addModuleOption, removeModuleOption,
  resetField, hasOverride,
} from "../runtimeConfig.js";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../..",
);

// ── Stage / module abbreviations ─────────────────────────────────────────

const STAGE_ABBR: Record<string, string> = {
  Att: "Attention", Idn: "Identification", Prb: "Problem", Ins: "Insight",
  Aut: "Authority", Mic: "Micro-value", Pos: "Possibility", FOM: "FOMO",
};
const STAGE_TO_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(STAGE_ABBR).map(([k, v]) => [v, k]),
);

const MOD_ABBR: Record<string, string> = {
  VH: "VISUAL_HOOK", VD: "VISUAL_DRAMA", CO: "COMPOSITION",
  ME: "MAIN_ELEMENT", SE: "SCROLL_EFFECT",
};
const MOD_TO_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(MOD_ABBR).map(([k, v]) => [v, k]),
);

// ── Main router ──────────────────────────────────────────────────────────

export async function handleConfigCallback(
  tg: TelegramClient,
  cb: CallbackQueryContext,
): Promise<void> {
  const data = cb.dataStr;
  if (!data?.startsWith("cfg:")) return;

  const userId = cb.user.id;
  const parts = data.slice(4).split(":");

  try {
    switch (parts[0]) {
      case "main": return await showConfigMain(cb);
      case "close": return await closeConfig(cb);
      case "photos": return await showPhotos(cb);
      case "ph": return await handlePhoto(tg, cb, userId, parts.slice(1));
      case "ann": return await handleAnnotation(tg, cb, userId, parts.slice(1));
      case "pr": return await handlePrompt(tg, cb, userId, parts.slice(1));
      case "tpl": return await handleTemplate(tg, cb, userId, parts.slice(1));
      case "stg": return await handleStageModules(cb, parts.slice(1));
      case "sm": return await handleStageModuleSelect(cb, parts.slice(1));
      case "sv": return await handleStageModuleSet(cb, parts.slice(1));
      case "mo": return await handleModuleOpts(cb, parts.slice(1));
      case "mr": return await handleModuleRemove(cb, parts.slice(1));
      case "ma": return await handleModuleAdd(tg, cb, userId, parts.slice(1));
      case "rst": return await handleReset(cb, parts.slice(1));
      default: await cb.answer({ text: "Unknown config action" });
    }
  } catch (err) {
    await devAlert("onDevConfig", err, { data, userId });
    try { await cb.answer({ text: "Error — check alerts" }); } catch { /* ignore */ }
  }
}

// ── Config main menu ─────────────────────────────────────────────────────

async function showConfigMain(cb: CallbackQueryContext): Promise<void> {
  await cb.answer({});

  const activeOverrides = (
    ["haikusSystemPrompt", "sonnetSystemPrompt", "imagePromptTemplate",
     "doctorPortrait", "bannerStyles", "stageModuleDefaults", "moduleOptions"] as const
  ).filter((f) => hasOverride(f)).length;

  const text = `⚙️ Configuration\n\n${activeOverrides} override(s) active`;

  await cb.editMessage({
    text,
    replyMarkup: BotKeyboard.inline([
      [
        BotKeyboard.callback("📷 Photos", "cfg:photos"),
        BotKeyboard.callback("📝 Annotations", "cfg:ann"),
      ],
      [
        BotKeyboard.callback("🤖 Prompts", "cfg:pr"),
        BotKeyboard.callback("🎨 Image tpl", "cfg:tpl"),
      ],
      [
        BotKeyboard.callback("📊 Stage modules", "cfg:stg"),
        BotKeyboard.callback("🧩 Module opts", "cfg:mo"),
      ],
      [BotKeyboard.callback("✕ Close", "cfg:close")],
    ]),
  });
}

async function closeConfig(cb: CallbackQueryContext): Promise<void> {
  await cb.answer({});
  await cb.editMessage({ text: "⚙️ Config closed." });
}

// ── Photos ───────────────────────────────────────────────────────────────

async function showPhotos(cb: CallbackQueryContext): Promise<void> {
  await cb.answer({});

  const doc = getDoctorPortrait();
  const styles = getBannerStyles();

  let text = "📷 Reference Photos\n\n";
  text += `Doctor: ${doc.path || "(empty)"}\n`;
  styles.forEach((s, i) => {
    text += `Banner ${i + 1}: ${s.path || "(empty)"}\n`;
  });

  const rows = [
    [
      BotKeyboard.callback("👨‍⚕️ Doctor", "cfg:ph:doc"),
    ],
  ];
  styles.forEach((_, i) => {
    rows.push([
      BotKeyboard.callback(`🖼 Banner ${i + 1}`, `cfg:ph:b${i}`),
    ]);
  });
  rows.push([BotKeyboard.callback("← Back", "cfg:main")]);

  await cb.editMessage({ text, replyMarkup: BotKeyboard.inline(rows) });
}

async function handlePhoto(
  tg: TelegramClient,
  cb: CallbackQueryContext,
  userId: number,
  parts: string[],
): Promise<void> {
  const target = parts[0]; // "doc" | "b0" | "b1"
  const action = parts[1]; // "view" | "rep" | "del" | undefined

  if (!action) {
    // Show photo details
    await cb.answer({});
    if (target === "doc") {
      const doc = getDoctorPortrait();
      const text = `👨‍⚕️ Doctor Portrait\n\nPath: ${doc.path || "(empty)"}\nHint: ${doc.promptHint.slice(0, 200)}`;
      await cb.editMessage({
        text,
        replyMarkup: BotKeyboard.inline([
          [
            BotKeyboard.callback("👁 View", "cfg:ph:doc:view"),
            BotKeyboard.callback("🔄 Replace", "cfg:ph:doc:rep"),
          ],
          [
            BotKeyboard.callback("🗑 Delete", "cfg:ph:doc:del"),
            BotKeyboard.callback("↩️ Reset", "cfg:rst:doc"),
          ],
          [BotKeyboard.callback("← Back", "cfg:photos")],
        ]),
      });
    } else {
      const idx = parseInt(target.slice(1), 10);
      const styles = getBannerStyles();
      const s = styles[idx];
      const text = s
        ? `🖼 Banner ${idx + 1}\n\nPath: ${s.path || "(empty)"}\nHint: ${s.promptHint.slice(0, 200)}`
        : `🖼 Banner ${idx + 1}\n\n(not configured)`;
      await cb.editMessage({
        text,
        replyMarkup: BotKeyboard.inline([
          [
            BotKeyboard.callback("👁 View", `cfg:ph:b${idx}:view`),
            BotKeyboard.callback("🔄 Replace", `cfg:ph:b${idx}:rep`),
          ],
          [
            BotKeyboard.callback("🗑 Delete", `cfg:ph:b${idx}:del`),
            BotKeyboard.callback("↩️ Reset", `cfg:rst:bn${idx}`),
          ],
          [BotKeyboard.callback("← Back", "cfg:photos")],
        ]),
      });
    }
    return;
  }

  if (action === "view") {
    await cb.answer({});
    let filePath: string | null = null;
    if (target === "doc") {
      filePath = getDoctorPortrait().path;
    } else {
      const idx = parseInt(target.slice(1), 10);
      filePath = getBannerStyles()[idx]?.path ?? null;
    }
    if (!filePath) {
      await tg.sendText(userId, "No photo set.");
      return;
    }
    try {
      const resolved = path.resolve(PROJECT_ROOT, filePath);
      const buf = fs.readFileSync(resolved);
      await tg.sendMedia(
        userId,
        InputMedia.photo(new Uint8Array(buf), { fileName: path.basename(filePath) }),
      );
    } catch {
      await tg.sendText(userId, `Failed to load: ${filePath}`);
    }
    return;
  }

  if (action === "rep") {
    await cb.answer({});
    globalState.devConfigAwait = { type: "photo", target, userId };
    await tg.sendText(userId, "📷 Send a new photo.");
    return;
  }

  if (action === "del") {
    await cb.answer({});
    if (target === "doc") {
      deleteDoctorPortrait();
    } else {
      const idx = parseInt(target.slice(1), 10);
      deleteBannerStyle(idx);
    }
    await cb.editMessage({
      text: "🗑 Photo deleted.",
      replyMarkup: BotKeyboard.inline([
        [BotKeyboard.callback("← Back", "cfg:photos")],
      ]),
    });
    return;
  }
}

// ── Annotations ──────────────────────────────────────────────────────────

async function handleAnnotation(
  tg: TelegramClient,
  cb: CallbackQueryContext,
  userId: number,
  parts: string[],
): Promise<void> {
  const target = parts[0]; // undefined | "doc" | "b0" | "b1"
  const action = parts[1]; // undefined | "edit"

  if (!target) {
    // Show annotations menu
    await cb.answer({});
    const doc = getDoctorPortrait();
    const styles = getBannerStyles();

    let text = "📝 Annotations\n\n";
    text += `👨‍⚕️ Doctor:\n${doc.promptHint.slice(0, 150)}...\n\n`;
    styles.forEach((s, i) => {
      text += `🖼 Banner ${i + 1}:\n${s.promptHint.slice(0, 150)}...\n\n`;
    });

    const rows = [
      [BotKeyboard.callback("👨‍⚕️ Doctor", "cfg:ann:doc")],
    ];
    styles.forEach((_, i) => {
      rows.push([BotKeyboard.callback(`🖼 Banner ${i + 1}`, `cfg:ann:b${i}`)]);
    });
    rows.push([BotKeyboard.callback("← Back", "cfg:main")]);

    await cb.editMessage({ text, replyMarkup: BotKeyboard.inline(rows) });
    return;
  }

  if (action === "edit") {
    await cb.answer({});
    globalState.devConfigAwait = { type: "text", target: `ann_${target}`, userId };
    await tg.sendText(userId, "📝 Send the new annotation text.");
    return;
  }

  // Show specific annotation with edit button
  await cb.answer({});
  let hint = "";
  let label = "";
  if (target === "doc") {
    hint = getDoctorPortrait().promptHint;
    label = "👨‍⚕️ Doctor";
  } else {
    const idx = parseInt(target.slice(1), 10);
    hint = getBannerStyles()[idx]?.promptHint ?? "";
    label = `🖼 Banner ${idx + 1}`;
  }

  await cb.editMessage({
    text: `${label} Annotation\n\n${hint}`,
    replyMarkup: BotKeyboard.inline([
      [BotKeyboard.callback("✏️ Edit", `cfg:ann:${target}:edit`)],
      [BotKeyboard.callback("← Back", "cfg:ann")],
    ]),
  });
}

// ── System prompts ───────────────────────────────────────────────────────

async function handlePrompt(
  tg: TelegramClient,
  cb: CallbackQueryContext,
  userId: number,
  parts: string[],
): Promise<void> {
  const target = parts[0]; // undefined | "gate" | "son"
  const action = parts[1]; // undefined | "edit" | "rst" | "view"

  if (!target) {
    await cb.answer({});
    const gateOv = hasOverride("haikusSystemPrompt") ? " ✏️" : "";
    const sonOv = hasOverride("sonnetSystemPrompt") ? " ✏️" : "";

    await cb.editMessage({
      text: `🤖 System Prompts\n\nGate (Haiku)${gateOv}\nAnalyze (Sonnet)${sonOv}`,
      replyMarkup: BotKeyboard.inline([
        [
          BotKeyboard.callback(`🚪 Gate${gateOv}`, "cfg:pr:gate"),
          BotKeyboard.callback(`🔬 Sonnet${sonOv}`, "cfg:pr:son"),
        ],
        [BotKeyboard.callback("← Back", "cfg:main")],
      ]),
    });
    return;
  }

  if (action === "edit") {
    await cb.answer({});
    const key = target === "gate" ? "gate_prompt" : "sonnet_prompt";
    globalState.devConfigAwait = { type: "text", target: key, userId };
    await tg.sendText(userId, "🤖 Send the new system prompt text.");
    return;
  }

  if (action === "rst") {
    await cb.answer({});
    if (target === "gate") {
      resetField("haikusSystemPrompt");
    } else {
      resetField("sonnetSystemPrompt");
    }
    await cb.editMessage({
      text: "↩️ Reset to default.",
      replyMarkup: BotKeyboard.inline([
        [BotKeyboard.callback("← Back", "cfg:pr")],
      ]),
    });
    return;
  }

  if (action === "view") {
    await cb.answer({});
    const text = target === "gate" ? getHaikuPrompt() : getSonnetPrompt();
    const chunks = splitMessage(text, 4000);
    for (const chunk of chunks) {
      await tg.sendText(userId, chunk);
    }
    return;
  }

  // Show prompt details
  await cb.answer({});
  const label = target === "gate" ? "🚪 Gate (Haiku)" : "🔬 Analyze (Sonnet)";
  const prompt = target === "gate" ? getHaikuPrompt() : getSonnetPrompt();
  const isOverride = target === "gate"
    ? hasOverride("haikusSystemPrompt")
    : hasOverride("sonnetSystemPrompt");

  const preview = prompt.slice(0, 500) + (prompt.length > 500 ? "..." : "");

  await cb.editMessage({
    text: `${label}\n${isOverride ? "(override active)" : "(default)"}\n\n${preview}`,
    replyMarkup: BotKeyboard.inline([
      [
        BotKeyboard.callback("👁 Full text", `cfg:pr:${target}:view`),
        BotKeyboard.callback("✏️ Edit", `cfg:pr:${target}:edit`),
      ],
      [
        BotKeyboard.callback("↩️ Reset", `cfg:pr:${target}:rst`),
        BotKeyboard.callback("← Back", "cfg:pr"),
      ],
    ]),
  });
}

// ── Image template ───────────────────────────────────────────────────────

async function handleTemplate(
  tg: TelegramClient,
  cb: CallbackQueryContext,
  userId: number,
  parts: string[],
): Promise<void> {
  const action = parts[0]; // undefined | "edit" | "rst" | "view"

  if (action === "edit") {
    await cb.answer({});
    globalState.devConfigAwait = { type: "text", target: "image_template", userId };
    await tg.sendText(userId, "🎨 Send the new image prompt template.\n\nPlaceholders: {modules}, {scene}, {headline}, {secondary}");
    return;
  }

  if (action === "rst") {
    await cb.answer({});
    resetField("imagePromptTemplate");
    await cb.editMessage({
      text: "↩️ Reset to default.",
      replyMarkup: BotKeyboard.inline([
        [BotKeyboard.callback("← Back", "cfg:main")],
      ]),
    });
    return;
  }

  if (action === "view") {
    await cb.answer({});
    const text = getImageTemplate();
    const chunks = splitMessage(text, 4000);
    for (const chunk of chunks) {
      await tg.sendText(userId, chunk);
    }
    return;
  }

  // Show template overview
  await cb.answer({});
  const tpl = getImageTemplate();
  const isOv = hasOverride("imagePromptTemplate");
  const preview = tpl.slice(0, 500) + (tpl.length > 500 ? "..." : "");

  await cb.editMessage({
    text: `🎨 Image Prompt Template\n${isOv ? "(override active)" : "(default)"}\n\n${preview}`,
    replyMarkup: BotKeyboard.inline([
      [
        BotKeyboard.callback("👁 Full text", "cfg:tpl:view"),
        BotKeyboard.callback("✏️ Edit", "cfg:tpl:edit"),
      ],
      [
        BotKeyboard.callback("↩️ Reset", "cfg:tpl:rst"),
        BotKeyboard.callback("← Back", "cfg:main"),
      ],
    ]),
  });
}

// ── Stage → Module defaults ──────────────────────────────────────────────

async function handleStageModules(
  cb: CallbackQueryContext,
  parts: string[],
): Promise<void> {
  const stageAbbr = parts[0]; // undefined | "Att" | "Idn" | ...

  if (!stageAbbr) {
    // List all stages
    await cb.answer({});
    const defaults = getStageModuleDefaults();
    let text = "📊 Stage → Module Defaults\n\n";
    for (const [stage, mods] of Object.entries(defaults)) {
      const vals = Object.values(mods).join(", ");
      text += `${stage}: ${vals.slice(0, 60)}\n`;
    }

    const rows: ReturnType<typeof BotKeyboard.callback>[][] = [];
    const stages = Object.keys(defaults);
    for (let i = 0; i < stages.length; i += 2) {
      const row = stages.slice(i, i + 2).map((s) => {
        const abbr = STAGE_TO_ABBR[s] ?? s.slice(0, 3);
        return BotKeyboard.callback(s, `cfg:stg:${abbr}`);
      });
      rows.push(row);
    }
    rows.push([BotKeyboard.callback("← Back", "cfg:main")]);

    await cb.editMessage({ text, replyMarkup: BotKeyboard.inline(rows) });
    return;
  }

  // Show modules for a specific stage
  const stage = STAGE_ABBR[stageAbbr];
  if (!stage) {
    await cb.answer({ text: "Unknown stage" });
    return;
  }

  await cb.answer({});
  const defaults = getStageModuleDefaults();
  const mods = defaults[stage] ?? {};

  let text = `📊 ${stage}\n\n`;
  for (const [mod, val] of Object.entries(mods)) {
    text += `${mod} = ${val}\n`;
  }

  const rows = Object.entries(mods).map(([mod]) => {
    const modAbbr = MOD_TO_ABBR[mod] ?? mod.slice(0, 2);
    return [BotKeyboard.callback(`⚙️ ${mod}`, `cfg:sm:${stageAbbr}:${modAbbr}`)];
  });
  rows.push([BotKeyboard.callback("← Back", "cfg:stg")]);

  await cb.editMessage({ text, replyMarkup: BotKeyboard.inline(rows) });
}

async function handleStageModuleSelect(
  cb: CallbackQueryContext,
  parts: string[],
): Promise<void> {
  // parts: [stageAbbr, modAbbr]
  const stageAbbr = parts[0];
  const modAbbr = parts[1];
  const stage = STAGE_ABBR[stageAbbr];
  const mod = MOD_ABBR[modAbbr];
  if (!stage || !mod) {
    await cb.answer({ text: "Unknown stage/module" });
    return;
  }

  await cb.answer({});
  const defaults = getStageModuleDefaults();
  const current = defaults[stage]?.[mod] ?? "";
  const options = getModuleOptions()[mod] ?? [];

  const text = `📊 ${stage} / ${mod}\n\nCurrent: ${current}\n\nPick a new value:`;

  const rows: ReturnType<typeof BotKeyboard.callback>[][] = [];
  for (let i = 0; i < options.length; i += 2) {
    const row = options.slice(i, i + 2).map((opt) => {
      const label = opt === current ? `✓ ${opt}` : opt;
      return BotKeyboard.callback(label, `cfg:sv:${stageAbbr}:${modAbbr}:${opt}`);
    });
    rows.push(row);
  }
  rows.push([BotKeyboard.callback("← Back", `cfg:stg:${stageAbbr}`)]);

  await cb.editMessage({ text, replyMarkup: BotKeyboard.inline(rows) });
}

async function handleStageModuleSet(
  cb: CallbackQueryContext,
  parts: string[],
): Promise<void> {
  // parts: [stageAbbr, modAbbr, value]
  const stageAbbr = parts[0];
  const modAbbr = parts[1];
  const value = parts.slice(2).join(":");
  const stage = STAGE_ABBR[stageAbbr];
  const mod = MOD_ABBR[modAbbr];
  if (!stage || !mod || !value) {
    await cb.answer({ text: "Invalid" });
    return;
  }

  setStageModuleDefault(stage, mod, value);
  await cb.answer({ text: `${mod} = ${value}` });

  // Re-show the module selection
  const current = value;
  const options = getModuleOptions()[mod] ?? [];

  const text = `📊 ${stage} / ${mod}\n\nCurrent: ${current}\n\nPick a new value:`;
  const rows: ReturnType<typeof BotKeyboard.callback>[][] = [];
  for (let i = 0; i < options.length; i += 2) {
    const row = options.slice(i, i + 2).map((opt) => {
      const label = opt === current ? `✓ ${opt}` : opt;
      return BotKeyboard.callback(label, `cfg:sv:${stageAbbr}:${modAbbr}:${opt}`);
    });
    rows.push(row);
  }
  rows.push([BotKeyboard.callback("← Back", `cfg:stg:${stageAbbr}`)]);

  await cb.editMessage({ text, replyMarkup: BotKeyboard.inline(rows) });
}

// ── Module options ───────────────────────────────────────────────────────

async function handleModuleOpts(
  cb: CallbackQueryContext,
  parts: string[],
): Promise<void> {
  const modAbbr = parts[0]; // undefined | "VH" | "VD" | ...

  if (!modAbbr) {
    // List all categories
    await cb.answer({});
    const opts = getModuleOptions();
    let text = "🧩 Module Options\n\n";
    for (const [cat, vals] of Object.entries(opts)) {
      text += `${cat}: ${vals.length} options\n`;
    }

    const rows = Object.keys(opts).map((cat) => {
      const abbr = MOD_TO_ABBR[cat] ?? cat.slice(0, 2);
      return [BotKeyboard.callback(`⚙️ ${cat}`, `cfg:mo:${abbr}`)];
    });
    rows.push([BotKeyboard.callback("← Back", "cfg:main")]);

    await cb.editMessage({ text, replyMarkup: BotKeyboard.inline(rows) });
    return;
  }

  // Show options for a category
  const cat = MOD_ABBR[modAbbr];
  if (!cat) {
    await cb.answer({ text: "Unknown category" });
    return;
  }

  await showModuleCategory(cb, modAbbr, cat);
}

async function showModuleCategory(
  cb: CallbackQueryContext,
  modAbbr: string,
  cat: string,
): Promise<void> {
  await cb.answer({});
  const options = getModuleOptions()[cat] ?? [];

  let text = `🧩 ${cat}\n\n`;
  text += options.join(", ");

  const rows: ReturnType<typeof BotKeyboard.callback>[][] = [];
  for (const opt of options) {
    rows.push([
      BotKeyboard.callback(`❌ ${opt}`, `cfg:mr:${modAbbr}:${opt}`),
    ]);
  }
  rows.push([BotKeyboard.callback("➕ Add option", `cfg:ma:${modAbbr}`)]);
  rows.push([BotKeyboard.callback("← Back", "cfg:mo")]);

  await cb.editMessage({ text, replyMarkup: BotKeyboard.inline(rows) });
}

async function handleModuleRemove(
  cb: CallbackQueryContext,
  parts: string[],
): Promise<void> {
  // parts: [modAbbr, ...optionParts]
  const modAbbr = parts[0];
  const option = parts.slice(1).join(":");
  const cat = MOD_ABBR[modAbbr];
  if (!cat || !option) {
    await cb.answer({ text: "Invalid" });
    return;
  }

  const removed = removeModuleOption(cat, option);
  if (removed) {
    await showModuleCategory(cb, modAbbr, cat);
  } else {
    await cb.answer({ text: "Option not found" });
  }
}

async function handleModuleAdd(
  tg: TelegramClient,
  cb: CallbackQueryContext,
  userId: number,
  parts: string[],
): Promise<void> {
  const modAbbr = parts[0];
  const cat = MOD_ABBR[modAbbr];
  if (!cat) {
    await cb.answer({ text: "Unknown category" });
    return;
  }

  await cb.answer({});
  globalState.devConfigAwait = { type: "text", target: `mod_add_${cat}`, userId };
  await tg.sendText(userId, `➕ Send the new option name for ${cat}.\n\nUse snake_case (e.g. my_new_hook).`);
}

// ── Reset ────────────────────────────────────────────────────────────────

async function handleReset(
  cb: CallbackQueryContext,
  parts: string[],
): Promise<void> {
  const target = parts[0]; // "doc" | "bn0" | "bn1" | ...

  if (target === "doc") {
    resetField("doctorPortrait");
  } else if (target?.startsWith("bn")) {
    resetField("bannerStyles");
  }

  await cb.answer({ text: "Reset to default" });
  await cb.editMessage({
    text: "↩️ Reset to default.",
    replyMarkup: BotKeyboard.inline([
      [BotKeyboard.callback("← Back", "cfg:photos")],
    ]),
  });
}

// ── Handle config text/photo input ───────────────────────────────────────

export async function handleConfigInput(
  tg: TelegramClient,
  msg: MessageContext,
): Promise<boolean> {
  const await_ = globalState.devConfigAwait;
  if (!await_) return false;

  const uid = msg.sender?.id;
  if (!uid || uid !== await_.userId) return false;

  globalState.devConfigAwait = null;

  if (await_.type === "photo") {
    const media = msg.media;
    if (!media || media.type !== "photo") {
      await tg.sendText(uid, "❌ Expected a photo. Cancelled.");
      return true;
    }

    try {
      const buf = await tg.downloadAsBuffer(media);
      const buffer = Buffer.from(buf);

      let filename: string;
      if (await_.target === "doc") {
        filename = "doctor_portrait_rt.jpg";
      } else {
        const idx = parseInt(await_.target.slice(1), 10);
        filename = `banner_ref_${idx + 1}_rt.jpg`;
      }

      const assetsDir = path.resolve(PROJECT_ROOT, "assets");
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
      }
      const filePath = path.resolve(assetsDir, filename);
      fs.writeFileSync(filePath, buffer);

      const relativePath = `./assets/${filename}`;

      if (await_.target === "doc") {
        setDoctorPortrait(relativePath);
      } else {
        const idx = parseInt(await_.target.slice(1), 10);
        setBannerStyle(idx, relativePath);
      }

      await tg.sendText(uid, `✅ Photo saved: ${relativePath}`);
    } catch (err) {
      await devAlert("config / photo upload", err);
      await tg.sendText(uid, "❌ Failed to save photo.");
    }
    return true;
  }

  if (await_.type === "text") {
    const text = msg.text?.trim();
    if (!text) {
      await tg.sendText(uid, "❌ Expected text. Cancelled.");
      return true;
    }

    const { target } = await_;

    if (target === "gate_prompt") {
      setHaikuPrompt(text);
      await tg.sendText(uid, `✅ Gate prompt updated (${text.length} chars).`);
    } else if (target === "sonnet_prompt") {
      setSonnetPrompt(text);
      await tg.sendText(uid, `✅ Sonnet prompt updated (${text.length} chars).`);
    } else if (target === "image_template") {
      setImageTemplate(text);
      await tg.sendText(uid, `✅ Image template updated (${text.length} chars).`);
    } else if (target === "ann_doc") {
      setDoctorAnnotation(text);
      await tg.sendText(uid, `✅ Doctor annotation updated.`);
    } else if (target.startsWith("ann_b")) {
      const idx = parseInt(target.slice(5), 10);
      setBannerAnnotation(idx, text);
      await tg.sendText(uid, `✅ Banner ${idx + 1} annotation updated.`);
    } else if (target.startsWith("mod_add_")) {
      const category = target.slice(8);
      const option = text.replace(/\s+/g, "_").toLowerCase();
      const added = addModuleOption(category, option);
      if (added) {
        await tg.sendText(uid, `✅ Added "${option}" to ${category}.`);
      } else {
        await tg.sendText(uid, `⚠️ "${option}" already exists in ${category}.`);
      }
    } else {
      await tg.sendText(uid, "❌ Unknown target. Cancelled.");
    }
    return true;
  }

  return false;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks.length > 0 ? chunks : [text];
}
