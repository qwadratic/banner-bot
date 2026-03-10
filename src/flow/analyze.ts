import type { SonnetOutput } from "../session.js";

// Phase 1: Mock Sonnet analysis — returns hardcoded FOMO response after 2s delay.
// If user provided a stage hint that differs from the mock's "FOMO", returns
// modelAgreesWithHint: false so the conflict-resolution flow can be tested.
export async function analyzeMessage(
  _inputText: string,
  hints: { stage?: string; style?: string },
): Promise<SonnetOutput> {
  await new Promise((r) => setTimeout(r, 2_000));

  const mockStage = "FOMO";
  const hintDisagrees = hints.stage != null && hints.stage !== mockStage;

  return {
    detectedStage: mockStage,
    confidence: "high",
    modelAgreesWithHint: hints.stage == null ? null : !hintDisagrees,
    disagreementReason: hintDisagrees
      ? `Mock: the text shows urgency patterns typical for ${mockStage}, not ${hints.stage}.`
      : null,
    modules: {
      VISUAL_HOOK: "contrast",
      VISUAL_DRAMA: "urgency",
      COMPOSITION: "centered_headline",
      MAIN_ELEMENT: "countdown_timer",
      SCROLL_EFFECT: "strong_contrast",
    },
    scene: "A dramatic countdown clock overlaid on a dark green medical background with bold yellow accent panels. A foot diagram fades into the background with urgent visual markers.",
    headline: "Останній день реєстрації!",
    secondary: "Приєднуйтесь до курсу ортопедії сьогодні",
  };
}

// Re-analyze with a forced stage (for "keep user stage" or "change stage")
export async function reanalyzeForStage(
  _inputText: string,
  stage: string,
  _hints: { style?: string },
): Promise<SonnetOutput> {
  await new Promise((r) => setTimeout(r, 2_000));

  // Mock: return the same structure but with the requested stage
  // In Phase 2 this will actually call Sonnet with the forced stage
  const { CONFIG } = await import("../config.js");
  const defaults = CONFIG.stageModuleDefaults[stage] ?? CONFIG.stageModuleDefaults["FOMO"];

  return {
    detectedStage: stage,
    confidence: "high",
    modelAgreesWithHint: true,
    disagreementReason: null,
    modules: {
      VISUAL_HOOK: defaults.VISUAL_HOOK,
      VISUAL_DRAMA: defaults.VISUAL_DRAMA,
      COMPOSITION: defaults.COMPOSITION,
      MAIN_ELEMENT: defaults.MAIN_ELEMENT,
      SCROLL_EFFECT: defaults.SCROLL_EFFECT,
    },
    scene: "A dramatic scene matching the selected stage with dark green medical background and bold typography.",
    headline: "Останній день реєстрації!",
    secondary: "Приєднуйтесь до курсу ортопедії сьогодні",
  };
}
