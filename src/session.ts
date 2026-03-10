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

export type ModuleSet = {
  VISUAL_HOOK: string;
  VISUAL_DRAMA: string;
  COMPOSITION: string;
  MAIN_ELEMENT: string;
  SCROLL_EFFECT: string;
};

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
  showPrompt: boolean;
  generatedPrompt: string | null;
  generationCount: number;
  pendingRating: number | null;
  pendingInterruptText: string | null;
  warningSent: boolean;
};

export type GlobalState = {
  activeSession: Session | null;
  devUserMode: boolean;
};

export const globalState: GlobalState = {
  activeSession: null,
  devUserMode: false,
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
    showPrompt: false,
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
