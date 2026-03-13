import { randomUUID } from "node:crypto";

export type SessionPhase =
  | "WAITING_FOR_MESSAGE"
  | "SYNTHESIZING"
  | "OBSERVING"
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

// ── Haiku DNA output ────────────────────────────────────────────────────

export type HaikuDnaOutput = {
  subject: string;
  object: string;
  environment: string;
  actions: string[];
  feeling: string;
  texture: string;
  tempo: string;
  color_mood: string;
  symbolism: string;
  tension: string;
  transformation: string;
};

// ── Sonnet consciousness output ─────────────────────────────────────────

export type SonnetOutput = {
  observation: string;
  goal: string;
  style: string;
  caption: string;
  scene: string;
  headline: string;
  secondary: string;
};

// ── API call stats ──────────────────────────────────────────────────────

export type ApiCallStats = {
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

// ── Session ─────────────────────────────────────────────────────────────

export type Session = {
  userId: number;
  sessionId: string;
  phase: SessionPhase;
  previousPhase: SessionPhase | null;
  lastActivityAt: number;
  seedWord: string;
  haikuDnaOutput: HaikuDnaOutput | null;
  sonnetOutput: SonnetOutput | null;
  generatedPrompt: string | null;
  generationCount: number;
  pendingRating: number | null;
  pendingInterruptText: string | null;
  warningSent: boolean;

  // Pipeline tracking — prompts sent to each model
  haikuSystemPrompt: string | null;
  haikuUserPrompt: string | null;
  sonnetSystemPrompt: string | null;
  sonnetUserPrompt: string | null;

  // Pipeline tracking — stats per step
  haikuStats: ApiCallStats | null;
  sonnetStats: ApiCallStats | null;
  imageStats: ApiCallStats | null;
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
    seedWord: "",
    haikuDnaOutput: null,
    sonnetOutput: null,
    generatedPrompt: null,
    generationCount: 0,
    pendingRating: null,
    pendingInterruptText: null,
    warningSent: false,
    haikuSystemPrompt: null,
    haikuUserPrompt: null,
    sonnetSystemPrompt: null,
    sonnetUserPrompt: null,
    haikuStats: null,
    sonnetStats: null,
    imageStats: null,
  };
}

export function touchSession(session: Session): void {
  session.lastActivityAt = Date.now();
  session.warningSent = false;
}
