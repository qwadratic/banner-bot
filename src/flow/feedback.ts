import type { Session } from "../session.js";
import { insertFeedback } from "../db/feedback.js";

export function saveFeedback(session: Session, rating: number, comment: string | null): void {
  const effectiveModules = session.modules
    ? { ...session.modules, ...session.userOverrides }
    : null;

  insertFeedback({
    userId: session.userId,
    sessionId: session.sessionId,
    inputText: session.inputText,
    stage: session.detectedStage,
    modules: effectiveModules ? JSON.stringify(effectiveModules) : null,
    imagePrompt: session.generatedPrompt,
    generationN: session.generationCount,
    rating,
    comment,
  });
}
