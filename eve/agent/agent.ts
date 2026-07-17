import { defineAgent } from 'eve';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// Direct OpenAI-compatible access to Sakana Fugu (subscription billing).
// Going through the AI Gateway would meter the same model per token.
// Note: response_format-style structured output is ignored by this endpoint;
// all structured data flows through tool inputs (submit_review) instead.
const sakana = createOpenAICompatible({
  name: 'sakana',
  baseURL: process.env.SAKANA_BASE_URL ?? 'https://api.sakana.ai/v1',
  apiKey: process.env.SAKANA_API_KEY ?? '',
});

export default defineAgent({
  model: sakana(process.env.PAVO_EVE_MODEL ?? 'fugu-ultra'),
});
