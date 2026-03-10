export const CONFIG = {
  models: {
    gate: "anthropic/claude-haiku-4-5",
    analyze: "anthropic/claude-sonnet-4.6",
    image: "google/gemini-3.1-flash-image-preview",
  },
} as const;

export const resolvedModels = {
  gate: process.env.MODEL_GATE ?? CONFIG.models.gate,
  analyze: process.env.MODEL_ANALYZE ?? CONFIG.models.analyze,
  image: process.env.MODEL_IMAGE ?? CONFIG.models.image,
};
