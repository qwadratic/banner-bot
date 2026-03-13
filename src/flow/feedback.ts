import type { Session } from "../session.js";
import { insertFeedback } from "../db/feedback.js";

export function saveFeedback(session: Session, rating: number, comment: string | null): void {
  insertFeedback({
    userId: session.userId,
    sessionId: session.sessionId,
    inputText: session.seedWord,
    stage: session.sonnetOutput?.style ?? null,
    modules: session.haikuDnaOutput ? JSON.stringify(session.haikuDnaOutput) : null,
    imagePrompt: session.generatedPrompt,
    generationN: session.generationCount,
    rating,
    comment,
  });
}
