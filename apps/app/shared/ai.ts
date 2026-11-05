import { z } from 'zod';

export const aiCredentialStatus = z.object({
  configured: z.boolean(),
  revision: z.number().int(),
});
const aiConversation = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.number(),
  revision: z.number().int(),
});
export const aiConversationList = z.object({
  items: z.array(aiConversation),
  next: z.object({ before: z.number(), beforeId: z.uuid() }).nullable(),
});
const aiTurn = z.object({
  id: z.uuid(),
  question: z.string(),
  answer: z.string(),
  status: z.enum(['running', 'complete', 'error', 'cancelled']),
  createdAt: z.number(),
});
export const aiTurnList = z.object({
  item: aiConversation,
  items: z.array(aiTurn),
  next: z.object({ before: z.number().int() }).nullable(),
});
export const aiEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), text: z.string() }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('done') }),
  z.object({ type: z.literal('error'), text: z.string() }),
]);
