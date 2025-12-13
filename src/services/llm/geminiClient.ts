import axios from 'axios';
import { config } from '../../config/env';

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_MODEL}:generateContent`;

export interface GeminiToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface GeminiResult {
  reply: string;
  toolCalls: GeminiToolCall[];
}

export async function callGemini(prompt: string, toolsSchema: unknown[]): Promise<GeminiResult> {
  if (!config.GOOGLE_AI_API_KEY) {
    return { reply: 'LLM is not configured (missing GOOGLE_AI_API_KEY).', toolCalls: [] };
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': config.GOOGLE_AI_API_KEY
  };
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    tools: toolsSchema.length > 0 ? [{ functionDeclarations: toolsSchema }] : undefined,
    safetySettings: [
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
    ]
  };

  const res = await axios.post(GEMINI_URL, payload, { headers, timeout: 8000 });

  type CandidatePart =
    | { text: string }
    | { functionCall: { name: string; args?: Record<string, unknown> } };

  const candidate = res.data?.candidates?.[0] as
    | { content?: { parts?: CandidatePart[] } }
    | undefined;

  const textParts =
    candidate?.content?.parts
      ?.filter((p): p is { text: string } => 'text' in p)
      ?.map((p) => p.text) ?? [];
  const reply = textParts.join('\n').trim();

  const toolCalls: GeminiToolCall[] =
    candidate?.content?.parts
      ?.filter(
        (p): p is { functionCall: { name: string; args?: Record<string, unknown> } } =>
          'functionCall' in p
      )
      ?.map((p) => ({
        name: p.functionCall.name,
        arguments: p.functionCall.args ?? {}
      })) ?? [];

  return { reply, toolCalls };
}
