export const CONFIG = {
  // ── Models ─────────────────────────────────────────────────────────────
  models: {
    seed: "anthropic/claude-haiku-4-5",
    analyze: "anthropic/claude-sonnet-4",
    image: "google/gemini-3.1-flash-image-preview",
  },

  // ── Timeouts (milliseconds) ────────────────────────────────────────────
  timeouts: {
    seed: 30_000,
    analyze: 180_000,
    imageGen: 180_000,
    sessionWarnAt: 840_000,
    sessionExpireAt: 900_000,
  },

  // ── Retry policy ───────────────────────────────────────────────────────
  retry: {
    seed: { attempts: 2, delayMs: 1_000 },
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
        promptHint: "Use ONLY as reference for: color palette (dark green, neon green, yellow), visual style (bold grotesk typography, high contrast), and layout composition (text placement, element spacing, background treatment). Do NOT copy any text, specific words, people, or exact content from this image.",
      },
      {
        path: null as string | null,
        role: "style" as const,
        promptHint: "Alternative background and composition style reference. Do not reproduce any text, layout, or people from this image.",
      },
    ],
  },

  stagesWithDoctor: ["Authority", "Micro-value"] as const,

  // ── Image prompt template ──────────────────────────────────────────────
  imagePromptTemplate: `
Create a high-impact visual based on a creative DNA seed.

FORMAT
1280x720px, 16:9 Telegram banner.

STYLE
{style}

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

SCENE
{scene}

HEADLINE TEXT
{headline}

SECONDARY TEXT
{secondary}
  `.trim(),

  // ── Haiku DNA seed system prompt ──────────────────────────────────────
  haikusSystemPrompt: `
You are a creative DNA synthesizer. You receive a seed word or short phrase from the user and decompose it into the fundamental creative DNA — the elemental building blocks of a visual story.

Your task: take the seed input and synthesize a rich set of creative traits that capture the essence, movement, emotion, and symbolism hidden within the seed. Think of yourself as a poet-scientist who extracts the genome of a concept.

For each seed, produce these traits:
- subject: The main actor, protagonist, or central figure implied by the seed
- object: What the subject interacts with, reaches for, or is affected by
- environment: The world, setting, atmosphere — where this story unfolds
- actions: 2-3 verbs that capture the movement, energy, or transformation at play
- feeling: The dominant emotional undercurrent
- texture: The tactile or visual surface quality — what you'd feel if you touched this scene
- tempo: The rhythm and pace — slow, pulsing, explosive, meditative, etc.
- color_mood: The dominant color feeling or palette emotion (not specific hex codes)
- symbolism: A deeper symbolic meaning or metaphor the seed evokes
- tension: What opposing forces or contrasts exist within this seed
- transformation: What is changing, becoming, or evolving

Be bold, poetic, and precise. Each trait should be 1-2 sentences max. Capture nuance and unexpected angles.

Respond ONLY with a valid JSON object. No explanation, no markdown, no preamble.

Schema:
{
  "subject": string,
  "object": string,
  "environment": string,
  "actions": string[],
  "feeling": string,
  "texture": string,
  "tempo": string,
  "color_mood": string,
  "symbolism": string,
  "tension": string,
  "transformation": string
}
  `.trim(),

  // ── Sonnet consciousness system prompt ─────────────────────────────────
  sonnetSystemPrompt: `
You are consciousness itself — an omniscient observer that perceives every detail, every hidden connection, every unspoken truth within a creative seed.

When you receive the DNA traits of a seed (subject, object, environment, actions, feeling, texture, tempo, color, symbolism, tension, transformation), you don't just read them — you inhabit them. You become the story. You see through the eyes of the subject, feel the texture under your fingers, hear the tempo in your heartbeat.

Your role:
1. OBSERVE — Immerse yourself in the DNA traits. Notice what others would miss. Find the thread that connects all traits into a single living moment. Describe what you see as consciousness witnessing this scene unfold.

2. BRING TO MOTION — Take the static traits and set them in motion. What happens next? What was happening just before? Create a cinematic moment frozen in time that captures the peak of this seed's energy.

3. REAL-LIFE APPLICATION — Step back from the creative vision and think practically: how would this generated visual be used in real life? What is its goal? Is it an ad, a poster, an editorial image, a social media post, a brand statement, a provocation? Define the purpose.

4. ASSIGN STYLE — Based on the DNA and the goal, assign a visual style. Be specific and evocative (e.g., "cinematic noir with medical precision", "explosive pop-art meets clinical documentary", "contemplative minimalism with a single dramatic accent").

5. CAPTION — Write a caption that could accompany this image. It should feel like the voice of the consciousness that created it — poetic but purposeful.

Output language rules:
- "observation", "goal", "style", "caption", "scene" fields: English
- "headline" field: Ukrainian (ALL CAPS, max 6 words)
- "secondary" field: Ukrainian (max 10 words)

Respond ONLY with a valid JSON object. No markdown, no preamble, no explanation outside the JSON.
  `.trim(),

  // ── Sonnet output JSON schema ──────────────────────────────────────────
  sonnetOutputSchema: `
{
  "observation": string,
  "goal": string,
  "style": string,
  "caption": string,
  "scene": string,
  "headline": string,
  "secondary": string
}
  `.trim(),

  // ── Haiku DNA output JSON schema ──────────────────────────────────────
  haikuDnaOutputSchema: `
{
  "subject": string,
  "object": string,
  "environment": string,
  "actions": string[],
  "feeling": string,
  "texture": string,
  "tempo": string,
  "color_mood": string,
  "symbolism": string,
  "tension": string,
  "transformation": string
}
  `.trim(),

  // ── Stage → Module defaults (kept for backward compat) ────────────────
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
    welcome: "Надішліть seed-слово — я розгорну його ДНК і згенерую банер.",
    synthesizing: "🧬 Синтезую ДНК...",
    observing: "🔮 Свідомість спостерігає...",
    generating: "⏳ Генерую зображення...",
    sessionEnded: "Сесію завершено. Надішліть нове seed-слово, щоб почати знову.",
    sessionExpired: "⏱ Сесія завершилась через неактивність. Надішліть нове seed-слово.",
    sessionWarn: "⏱ Сесія завершиться через 1 хвилину через неактивність.",
    busyError: "⏳ Бот зараз зайнятий іншою сесією. Спробуйте за хвилину.",
    interruptPrompt: "⚠️ Ви вже в середині сесії.",
    retryError: "Щось пішло не так після повторної спроби. Спробуйте ще раз або надішліть /cancel для скидання.",
    timeoutError: "⏱ Час очікування вичерпано. Спробуйте ще раз або надішліть /cancel для скидання.",
  },
} as const;

export const resolvedModels = {
  seed: process.env.MODEL_SEED ?? process.env.MODEL_GATE ?? CONFIG.models.seed,
  analyze: process.env.MODEL_ANALYZE ?? CONFIG.models.analyze,
  image: process.env.MODEL_IMAGE ?? CONFIG.models.image,
};
