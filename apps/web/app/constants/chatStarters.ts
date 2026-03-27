export type ChatStarterPrompt = {
  title: string;
  message: string;
};

/** Two agreed starters; add a third via `NEXT_PUBLIC_CHAT_STARTER_PROMPTS` when product decides. */
const DEFAULT_PROMPTS: ChatStarterPrompt[] = [
  { title: "Tic tac toe", message: "Create a tic tac toe game" },
  { title: "Flow charts", message: "Create an app that creates flow charts" },
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
    return dedupeStarterPrompts(out.length > 0 ? out : DEFAULT_PROMPTS);
  } catch {
    return DEFAULT_PROMPTS;
  }
}

/** Drop duplicate title+message pairs (e.g. mis-merged env) so the UI does not repeat chips. */
function dedupeStarterPrompts(prompts: ChatStarterPrompt[]): ChatStarterPrompt[] {
  const seen = new Set<string>();
  const result: ChatStarterPrompt[] = [];
  for (const p of prompts) {
    const key = `${p.title.trim()}\n${p.message.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(p);
  }
  return result;
}
