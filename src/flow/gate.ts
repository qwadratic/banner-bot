// Phase 1: Mock Haiku gate — always returns isFunnelMessage: true
export async function classifyMessage(
  _inputText: string,
): Promise<{ isFunnelMessage: boolean; confidence: "high" | "medium" | "low" }> {
  // Mock: no delay, always funnel message
  return { isFunnelMessage: true, confidence: "high" };
}
