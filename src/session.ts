import { randomUUID } from "node:crypto";

export type SessionPhase =
  | "WAITING_FOR_MESSAGE"
  | "HINT_STAGE"
  | "HINT_STYLE"
  | "ANALYZING"
  | "ANALYSIS_READY"
  | "GENERATING"
  | "RESULT_READY"
  | "AWAITING_FEEDBACK_RATING"
  | "AWAITING_FEEDBACK_COMMENT"
  | "AWAITING_INTERRUPT_RESOLUTION";

export const MODULE_KEYS = [
  "VISUAL_HOOK", "VISUAL_DRAMA", "COMPOSITION", "MAIN_ELEMENT", "SCROLL_EFFECT",
] as const;

export type ModuleKey = typeof MODULE_KEYS[number];

export type ModuleSet = Record<ModuleKey, string>;

export type SonnetOutput = {
  detectedStage: string;
  confidence: "high" | "medium" | "low";
  modelAgreesWithHint: boolean | null;
  disagreementReason: string | null;
  modules: ModuleSet;
  scene: string;
  headline: string;
  secondary: string;
};

export type Session = {
  userId: number;
  sessionId: string;
  phase: SessionPhase;
  previousPhase: SessionPhase | null;
  lastActivityAt: number;
  inputText: string;
  selectedHints: {
    stage?: string;
    style?: string;
  };
  detectedStage: string | null;
  stageConfidence: "high" | "medium" | "low" | null;
  modelAgreesWithHint: boolean | null;
  disagreementReason: string | null;
  modules: ModuleSet | null;
  userOverrides: Partial<ModuleSet>;
  sonnetOutput: SonnetOutput | null;
  generatedPrompt: string | null;
  generationCount: number;
  pendingRating: number | null;
  pendingInterruptText: string | null;
  warningSent: boolean;
};

export type DevConfigAwait = {
  type: "photo";
  target: string; // "doc" | "b0" | "b1"
  userId: number;
} | {
  type: "text";
  target: string; // "gate_prompt" | "sonnet_prompt" | "image_template" | "ann_doc" | "ann_b0" | "mod_add_VISUAL_HOOK" etc.
  userId: number;
} | {
  type: "admin_add";
  userId: number;
} | null;

export type GlobalState = {
  activeSession: Session | null;
  devUserMode: boolean;
  devConfigAwait: DevConfigAwait;
  testMode: boolean;
};

export const globalState: GlobalState = {
  activeSession: null,
  devUserMode: false,
  devConfigAwait: null,
  testMode: false,
};

export function createSession(userId: number): Session {
  return {
    userId,
    sessionId: randomUUID(),
    phase: "WAITING_FOR_MESSAGE",
    previousPhase: null,
    lastActivityAt: Date.now(),
    inputText: "",
    selectedHints: {},
    detectedStage: null,
    stageConfidence: null,
    modelAgreesWithHint: null,
    disagreementReason: null,
    modules: null,
    userOverrides: {},
    sonnetOutput: null,
    generatedPrompt: null,
    generationCount: 0,
    pendingRating: null,
    pendingInterruptText: null,
    warningSent: false,
  };
}

export function touchSession(session: Session): void {
  session.lastActivityAt = Date.now();
  session.warningSent = false;
}

export function getEffectiveModules(session: Session): ModuleSet | null {
  if (!session.modules) return null;
  return { ...session.modules, ...session.userOverrides };
}
