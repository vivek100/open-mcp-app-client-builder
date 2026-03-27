export type ChatStarterPrompt = {
  title: string;
  message: string;
};

const DEFAULT_PROMPTS: ChatStarterPrompt[] = [
  { title: "Tic tac toe", message: "Create a tic tac toe game" },
  { title: "Flow charts", message: "Create an app that creates flow charts" },
  { title: "Stock chart", message: "Build a stock chart widget" },
];

/**
 * Chat suggestion chips for v2 CopilotChat (see `ChatSuggestions.tsx`).
 * Override with `NEXT_PUBLIC_CHAT_STARTER_PROMPTS` — JSON array of `{ "title", "message" }`.
 */
export function getChatStarterPrompts(): ChatStarterPrompt[] {
  const raw = process.env.NEXT_PUBLIC_CHAT_STARTER_PROMPTS;
  if (typeof raw !== "string" || !raw.trim()) {
    return DEFAULT_PROMPTS;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return DEFAULT_PROMPTS;
    }
    const out: ChatStarterPrompt[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const title = rec.title;
      const message = rec.message;
      if (typeof title !== "string" || typeof message !== "string") continue;
      const t = title.trim();
      const m = message.trim();
      if (!t || !m) continue;
      out.push({ title: t, message: m });
    }
    return out.length > 0 ? out : DEFAULT_PROMPTS;
  } catch {
    return DEFAULT_PROMPTS;
  }
}
