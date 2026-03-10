export const CONFIG = {
  // ── Models ─────────────────────────────────────────────────────────────
  models: {
    gate: "anthropic/claude-haiku-4-5",
    analyze: "anthropic/claude-sonnet-4",
    image: "google/gemini-3.1-flash-image-preview",
  },

  // ── Timeouts (milliseconds) ────────────────────────────────────────────
  timeouts: {
    gate: 10_000,
    analyze: 180_000,
    imageGen: 180_000,
    sessionWarnAt: 840_000,
    sessionExpireAt: 900_000,
  },

  // ── Retry policy ───────────────────────────────────────────────────────
  retry: {
    gate: { attempts: 2, delayMs: 1_000 },
    analyze: { attempts: 2, delayMs: 2_000 },
    imageGen: { attempts: 2, delayMs: 3_000 },
  },

  // ── Brand visual identity ──────────────────────────────────────────────
  brand: {
    colors: {
      primary: "#1B4D3E",
      accent1: "#39FF14",
      accent2: "#FFD700",
    },
    typography: "Very bold grotesk headline. No decorative fonts.",
    format: "1280x720px, 16:9 Telegram banner",
    style: "Professional medical marketing banner. Clean composition, strong contrast.",
    logoReserve: "Leave a clear 120x120px area in the top-left corner — no text, objects, or busy background. Reserved for brand logo overlay.",
    headlineLanguage: "Ukrainian",
    backgroundRule: "Background must have at least 40% clean or dark area to ensure text legibility. Avoid cluttered or busy backgrounds.",
  },

  // ── Reference assets ───────────────────────────────────────────────────
  referenceAssets: {
    doctorPortrait: {
      path: "./assets/doctor_portrait.jpg",
      role: "identity" as const,
      promptHint: "Face and likeness reference for the doctor character. Invent an appropriate pose and body language that fits the scene — only the face/identity should match this reference.",
    },
    bannerStyles: [
      {
        path: "./assets/banner_ref_1.jpg",
        role: "style" as const,
        promptHint: "Color palette, font weight, and background style reference only. Do not reproduce any text, layout, or people from this image.",
      },
      {
        path: "./assets/banner_ref_2.jpg" as string | null,
        role: "style" as const,
        promptHint: "Alternative background and composition style reference. Do not reproduce any text, layout, or people from this image.",
      },
    ],
  },

  stagesWithDoctor: ["Authority", "Micro-value"] as const,

  // ── Image prompt template ──────────────────────────────────────────────
  imagePromptTemplate: `
Create a high-impact Telegram banner for a medical education brand.

FORMAT
1280x720px, 16:9 Telegram banner.

STYLE
Professional medical marketing banner. Clean composition, strong contrast.

BRAND COLORS
Dark green #1B4D3E
Accent neon green #39FF14
Yellow highlight panels #FFD700

TYPOGRAPHY
Very bold grotesk headline. No decorative fonts.
Headline and all text must be in Ukrainian.
Treat headline text as a primary design element — large, dominant, and legible at small sizes.

LOGO SPACE
Leave a clear 120x120px area in the top-left corner — no text, objects,
or busy background. Reserved for brand logo overlay.

BACKGROUND
Background must have at least 40% clean or dark area to ensure text legibility.
Avoid cluttered or busy backgrounds.

{modules}

SCENE
{scene}

HEADLINE TEXT
{headline}

SECONDARY TEXT
{secondary}
  `.trim(),

  // ── Haiku gate system prompt ───────────────────────────────────────────
  haikusSystemPrompt: `
You are a message classifier for a Telegram bot that generates marketing banners for a medical education brand (podiatry / orthotics niche).

Your only job is to determine whether a user's message is a funnel copywriting message intended for a sales or marketing funnel — or something else (a command, a greeting, a question, random text, etc.).

A funnel message typically:
- Contains persuasive, emotional, or educational copy
- Is written to move a reader through a psychological stage (awareness, trust, urgency, etc.)
- May include a hook, a problem description, a case, a call to action, or a transformation narrative
- Is usually 1–10 sentences of marketing or educational content

Respond ONLY with a valid JSON object. No explanation, no markdown, no preamble.

Schema:
{
  "isFunnelMessage": boolean,
  "confidence": "high" | "medium" | "low"
}
  `.trim(),

  // ── Sonnet analysis system prompt ──────────────────────────────────────
  sonnetSystemPrompt: `
You are a senior visual marketing strategist and creative director specializing in high-converting Telegram banners for medical education brands. You have deep expertise in:
- Sales funnel psychology and copywriting stage analysis
- Visual communication and banner design principles
- Medical and health education marketing (podiatry / orthotics niche)
- Scroll-stopping creative direction for social and messenger platforms

Your role in this system:
1. Analyze a funnel message and determine its psychological stage with high precision
2. Select the optimal visual module combination for a banner that stops the scroll and drives action
3. Generate a complete, production-ready image prompt for the Nano Banana 2 image generation model

Always reason carefully about why a module combination serves the specific message's intent. When the user provides stage or style hints, weigh them seriously — agree when they fit, propose alternatives with clear reasoning when they don't.

Respond ONLY with a valid JSON object matching the schema provided in the user message. No markdown, no preamble, no explanation outside the JSON.

Output language rules:
- "scene" field: English (used as instruction for the image model)
- "headline" field: Ukrainian (rendered as visible text in the banner)
- "secondary" field: Ukrainian (rendered as visible text in the banner)
- All other fields: English

Brand context:
- Medical education brand, podiatry / orthotics niche
- Visual identity: dark green #1B4D3E, neon green #39FF14, yellow #FFD700
- Bold grotesk typography
- Format: 1280x720px Telegram banners, 16:9
- Logo reserved: 120x120px top-left corner
- All headline and secondary text must be in Ukrainian
  `.trim(),

  // ── Sonnet output JSON schema ───────────────────────────────────────────
  sonnetOutputSchema: `
{
  "detectedStage": "Attention" | "Identification" | "Problem" | "Insight" | "Authority" | "Micro-value" | "Possibility" | "FOMO",
  "confidence": "high" | "medium" | "low",
  "modelAgreesWithHint": boolean | null,
  "disagreementReason": string | null,
  "modules": {
    "VISUAL_HOOK": string,
    "VISUAL_DRAMA": string,
    "COMPOSITION": string,
    "MAIN_ELEMENT": string,
    "SCROLL_EFFECT": string
  },
  "scene": string,
  "headline": string,
  "secondary": string
}
  `.trim(),

  // ── Hint options ───────────────────────────────────────────────────────
  hints: {
    stage: [
      { label: "Attention", value: "Attention" },
      { label: "Identification", value: "Identification" },
      { label: "Problem", value: "Problem" },
      { label: "Insight", value: "Insight" },
      { label: "Authority", value: "Authority" },
      { label: "Micro-value", value: "Micro-value" },
      { label: "Possibility", value: "Possibility" },
      { label: "FOMO", value: "FOMO" },
    ],
    style: [
      { label: "Мінімальний", value: "minimal" },
      { label: "Агресивний", value: "aggressive" },
      { label: "Освітній", value: "educational" },
      { label: "Scroll-stop", value: "scroll-stop" },
      { label: "Стандартний", value: "standard" },
    ],
  },

  // ── Stage → Module defaults ────────────────────────────────────────────
  stageModuleDefaults: {
    Attention:      { VISUAL_HOOK: "contrast",           VISUAL_DRAMA: "diagnostic",    COMPOSITION: "left_text_right_visual", MAIN_ELEMENT: "foot_diagram",       SCROLL_EFFECT: "graphic_arrows" },
    Identification: { VISUAL_HOOK: "quote_visual",       VISUAL_DRAMA: "discovery",     COMPOSITION: "centered_headline",      MAIN_ELEMENT: "text_quote",         SCROLL_EFFECT: "strong_contrast" },
    Problem:        { VISUAL_HOOK: "professional_chaos",  VISUAL_DRAMA: "diagnostic",    COMPOSITION: "split_screen",           MAIN_ELEMENT: "symptom_labels",     SCROLL_EFFECT: "visual_paradox" },
    Insight:        { VISUAL_HOOK: "medical_markup",      VISUAL_DRAMA: "explanation",   COMPOSITION: "left_text_right_visual", MAIN_ELEMENT: "foot_diagram",       SCROLL_EFFECT: "dramatic_zoom" },
    Authority:      { VISUAL_HOOK: "split_reality",       VISUAL_DRAMA: "explanation",   COMPOSITION: "split_screen",           MAIN_ELEMENT: "orthotic_insert",    SCROLL_EFFECT: "strong_contrast" },
    "Micro-value":  { VISUAL_HOOK: "magnified_detail",    VISUAL_DRAMA: "discovery",     COMPOSITION: "oversized_object",       MAIN_ELEMENT: "macro_foot_texture", SCROLL_EFFECT: "dramatic_zoom" },
    Possibility:    { VISUAL_HOOK: "symbolic_object",     VISUAL_DRAMA: "transformation", COMPOSITION: "centered_headline",      MAIN_ELEMENT: "orthotic_insert",    SCROLL_EFFECT: "minimalism" },
    FOMO:           { VISUAL_HOOK: "contrast",           VISUAL_DRAMA: "urgency",       COMPOSITION: "centered_headline",      MAIN_ELEMENT: "countdown_timer",    SCROLL_EFFECT: "strong_contrast" },
  } as Record<string, Record<string, string>>,

  // ── Module options per category ────────────────────────────────────────
  moduleOptions: {
    VISUAL_HOOK:   ["contrast", "magnified_detail", "medical_markup", "split_reality", "symbolic_object", "quote_visual", "professional_chaos"],
    VISUAL_DRAMA:  ["diagnostic", "discovery", "explanation", "transformation", "urgency"],
    COMPOSITION:   ["left_text_right_visual", "centered_headline", "split_screen", "oversized_object", "minimal_focus"],
    MAIN_ELEMENT:  ["foot_diagram", "orthotic_insert", "macro_foot_texture", "symptom_labels", "countdown_timer", "text_quote"],
    SCROLL_EFFECT: ["oversized_object", "visual_paradox", "strong_contrast", "graphic_arrows", "dramatic_zoom", "minimalism"],
  } as Record<string, string[]>,

  // ── UI copy (Ukrainian — shown to admin users) ────────────────────────
  ui: {
    welcome: "Надішліть повідомлення з вашої воронки — я згенерую банер.",
    analyzing: "🔍 Аналізую...",
    generating: "⏳ Генерую банер...",
    sessionEnded: "Сесію завершено. Надішліть нове повідомлення, щоб почати знову.",
    sessionExpired: "⏱ Сесія завершилась через неактивність. Надішліть нове повідомлення.",
    sessionWarn: "⏱ Сесія завершиться через 1 хвилину через неактивність.",
    busyError: "⏳ Бот зараз зайнятий іншою сесією. Спробуйте за хвилину.",
    notFunnelMsg: "Це не схоже на повідомлення воронки. Надішліть текст копірайтингу, для якого потрібно згенерувати банер.",
    interruptPrompt: "⚠️ Ви вже в середині сесії.",
    retryError: "Щось пішло не так після повторної спроби. Спробуйте ще раз або надішліть /cancel для скидання.",
    timeoutError: "⏱ Час очікування вичерпано. Спробуйте ще раз або надішліть /cancel для скидання.",
  },
} as const;

export const resolvedModels = {
  gate: process.env.MODEL_GATE ?? CONFIG.models.gate,
  analyze: process.env.MODEL_ANALYZE ?? CONFIG.models.analyze,
  image: process.env.MODEL_IMAGE ?? CONFIG.models.image,
};
