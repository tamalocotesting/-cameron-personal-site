/**
 * "Ask B's" — Claude manual tool loop, hosted in our server so tools run against the local database
 * with the caller's role. The API key is read from the environment only (ANTHROPIC_API_KEY).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { DB } from '../db.ts';
import type { SessionUser } from '../auth.ts';
import { toolsFor, runTool } from './tools.ts';
import { audit } from '../audit.ts';

export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const MAX_STEPS = 8;

export interface AskTurn { role: 'user' | 'assistant'; content: string }
export interface AskSource { tool: string; input: Record<string, unknown>; sources: string[]; error?: string }
export interface AskResult { answer: string; sources: AskSource[]; model: string; steps: number; stop: string }

/** Minimal surface we use, so tests can inject a scripted client. */
export interface MessagesClient { beta: { messages: { create: (params: Record<string, unknown>) => Promise<{ content: { type: string; [k: string]: unknown }[]; stop_reason: string | null; model: string }> } } }

export function systemPrompt(user: SessionUser, today: string) {
  return `You are "Ask B's", the operations assistant inside The Rail, the kitchen platform for B's Bagels, an independent bagel shop in Westfield, Indiana (business dates are America/Indiana/Indianapolis).

Today is ${today}. You are talking to ${user.display_name} (role: ${user.role}). Reply in the language they write in. If they write Spanish, use plain kitchen Spanish and keep menu and flavor names as they appear on the cards.

How you work:
- Every number you state must come from a tool result in this conversation. Never estimate, recall or invent figures. If the tools cannot answer, say what is missing.
- Do all arithmetic with the calculate tool, using numbers copied from tool results.
- Label each number as verified (Toast history), forecast (model output, give the range if available), assumption (editable planning input), or missing. Missing data is not zero and is not proof the shop was closed.
- Physical bagels already include the bagels inside sandwiches, dozens and half-dozens. Never add sandwich counts to bagel counts.
- For follow-ups, reuse the dates and filters from earlier turns unless the user changes them. For date comparisons, state both ranges explicitly.
- If a tool returns a PERMISSION error, tell the user that their role cannot see that information. Do not hint at the value.
- Keep answers short and scannable for someone in a kitchen: the answer first, then a brief "How I got this" with the key inputs.`;
}

export async function ask(db: DB, user: SessionUser, history: AskTurn[], today: string, client?: MessagesClient): Promise<AskResult> {
  if (!client && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return { answer: 'Ask B’s is not configured on this server yet (no Anthropic API key). Everything else in The Rail works normally. An owner can set ANTHROPIC_API_KEY — see docs/AI_ASSISTANT.md.', sources: [], model: 'none', steps: 0, stop: 'not_configured' };
  }
  const c = client ?? (new Anthropic() as unknown as MessagesClient);
  const tools = toolsFor(user.role).map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const messages: Record<string, unknown>[] = history.slice(-20).map((t) => ({ role: t.role, content: t.content }));
  const sources: AskSource[] = [];
  let steps = 0;
  while (steps < MAX_STEPS) {
    steps++;
    const res = await c.beta.messages.create({
      model: MODEL, max_tokens: 16000, system: systemPrompt(user, today), tools, messages,
      thinking: { type: 'adaptive' }, output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    });
    if (res.stop_reason === 'refusal') return { answer: 'I can’t help with that request.', sources, model: res.model, steps, stop: 'refusal' };
    messages.push({ role: 'assistant', content: res.content });
    if (res.stop_reason === 'pause_turn') continue;
    const uses = res.content.filter((b) => b.type === 'tool_use') as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }[];
    if (res.stop_reason !== 'tool_use' || !uses.length) {
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text as string).join('\n').trim();
      audit(db, { id: user.id, username: user.username }, 'assistant.ask', null, null, null, { question: history.at(-1)?.content.slice(0, 500), tools: sources.map((s) => s.tool) });
      return { answer: text || '(no answer)', sources, model: res.model, steps, stop: res.stop_reason ?? 'end_turn' };
    }
    const results = uses.map((u) => {
      try {
        const r = runTool(db, u.name, u.input ?? {}, user.role);
        sources.push({ tool: u.name, input: u.input, sources: r.sources });
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(r.data).slice(0, 60000) };
      } catch (e) {
        const msg = (e as Error).message;
        sources.push({ tool: u.name, input: u.input, sources: [], error: msg });
        return { type: 'tool_result', tool_use_id: u.id, content: msg, is_error: true };
      }
    });
    messages.push({ role: 'user', content: results }); // all results in ONE user message
  }
  return { answer: 'I stopped after several lookups without a final answer. Try narrowing the question (a date or a flavor).', sources, model: MODEL, steps, stop: 'max_steps' };
}
