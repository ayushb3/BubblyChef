/**
 * "The AI is down" detection for the smoke suite (issue #773).
 *
 * When the ai-service cannot reach its model it still answers the chat stream
 * with a 200 and a canned reply (PR #736): the text comes from
 * `FAILURE_MESSAGES` / `NOT_CONFIGURED_MESSAGE` in
 * ai-service/bubbly_chef/ai/provider.py and the envelope carries
 * `metadata.ai_error_kind`. A smoke test that only checks "some reply arrived"
 * stays green through a full outage, so it asks this module instead.
 *
 * Two independent signals, either one means "unavailable":
 *   1. `metadata.ai_error_kind` on the streamed envelope (the machine-readable
 *      tag; survives a copy edit);
 *   2. the reply text equal to one of the known canned messages (covers a
 *      server that drops the tag).
 * Real reply content is never asserted on, it is model-dependent.
 *
 * The list below mirrors provider.py. The pytest guard
 * ai-service/tests/test_smoke_ai_unavailable_copy.py fails if the two drift,
 * so a copy edit on the Python side cannot silently blind the smoke test.
 */

export const AI_UNAVAILABLE_COPY: readonly string[] = [
  'No AI provider is configured. Please add a Gemini API key or start Ollama.',
  "Bubbly's AI is over its budget right now. Please try again later.",
  'The AI is busy, try again in a minute.',
  "Bubbly's AI can't sign in right now. The team needs to fix its key, so please try again later.",
  "Bubbly's AI can't find the model it needs right now. Please try again later.",
  "Bubbly's AI is having trouble connecting, try again in a moment.",
  "Bubbly's AI hit a snag, try again in a moment.",
];

/**
 * `metadata.ai_error_kind` from a raw `/v1/chat/stream` SSE body, or null when
 * the stream carried no envelope or an ordinary answer. Tolerates the `event:`
 * lines and any non-JSON `data:` line (a token chunk, a keep-alive).
 */
export function aiErrorKindFromStream(sseBody: string): string | null {
  for (const line of sseBody.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    let parsed: { data?: { metadata?: { ai_error_kind?: unknown } } };
    try {
      parsed = JSON.parse(line.slice(6));
    } catch {
      continue;
    }
    const kind = parsed?.data?.metadata?.ai_error_kind;
    if (typeof kind === 'string' && kind.length > 0) return kind;
  }
  return null;
}

/** Why this reply is the AI-unavailable one, or null when it looks like a real answer. */
export function aiUnavailableReason(streamBody: string, replyText: string): string | null {
  const kind = aiErrorKindFromStream(streamBody);
  if (kind) return `the stream's envelope carried metadata.ai_error_kind="${kind}"`;
  const text = replyText.trim();
  const canned = AI_UNAVAILABLE_COPY.find((copy) => text.includes(copy));
  if (canned) return `the reply is the canned AI-unavailable message "${canned}"`;
  return null;
}

/** Throws when the chat reply is the AI-unavailable one; a normal reply passes. */
export function assertChatReplyIsNotAiUnavailable(streamBody: string, replyText: string): void {
  const reason = aiUnavailableReason(streamBody, replyText);
  if (reason) {
    throw new Error(`Chat replied "AI unavailable", so the AI path is down: ${reason}.`);
  }
}
