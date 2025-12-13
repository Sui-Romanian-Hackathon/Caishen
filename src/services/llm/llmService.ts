import { SessionData } from '../session/sessionStore';
import { toolDefinitions, type ToolName } from './tools';
import { invokeTool } from './toolHandlers';
import { callGemini } from './geminiClient';

export interface LlmResponse {
  reply: string;
  intent: 'chat' | 'balance' | 'send' | 'unknown';
}

export async function draftAssistantResponse(
  message: string,
  session: SessionData
): Promise<LlmResponse> {
  const prompt = buildPrompt(message, session);
  const tools = toolDefinitions.map((tool) => tool.schema);

  try {
    const result = await callGemini(prompt, tools);

    if (result.toolCalls.length > 0) {
      const responses: string[] = [];
      
      for (const call of result.toolCalls) {
        const toolResult = await invokeTool(
          call.name as ToolName,
          call.arguments as never,
          { userId: session.userId, walletAddress: session.walletAddress }  // ← Pass wallet for enforcement
        );
        
        // Format tool result into human-readable response
        responses.push(JSON.stringify(toolResult, null, 2));
      }

      // Combine tool results with LLM's reply
      const toolOutput = responses.join('\n\n');
      const combinedReply = result.reply 
        ? `${result.reply}\n\n${toolOutput}` 
        : toolOutput;

      return {
        reply: combinedReply,
        intent: detectIntent(message, result.toolCalls)
      };
    }

    // Simple heuristic intent detection
    return { 
      reply: result.reply || 'Acknowledged.', 
      intent: detectIntent(message, [])
    };
  } catch (err) {
    return {
      reply: `Error processing request: ${err instanceof Error ? err.message : 'Unknown error'}`,
      intent: 'unknown'
    };
  }
}

function detectIntent(message: string, toolCalls: { name: string }[]): LlmResponse['intent'] {
  const lower = message.toLowerCase();
  
  // Check tool calls first
  if (toolCalls.some(t => t.name === 'get_balance')) return 'balance';
  if (toolCalls.some(t => t.name.includes('send') || t.name.includes('transfer'))) return 'send';
  
  // Fallback to keyword detection
  if (lower.includes('balance') || lower.includes('how much')) return 'balance';
  if (lower.includes('send') || lower.includes('transfer') || lower.includes('pay')) return 'send';
  
  return 'chat';
}

function buildPrompt(message: string, session: SessionData) {
  const wallet = session.walletAddress
    ? `Linked wallet: ${session.walletAddress}`
    : 'No wallet linked.';
  const historyText =
    session.history.length === 0
      ? ''
      : session.history
          .map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`)
          .join('\n');
  const context = `${wallet}\nConversation:\n${historyText}\nUser said: ${message}`;
  return `You are the Caishen wallet copilot. Be concise, prefer tool calls when possible. If unsure, ask a short clarifying question.\n${context}`;
}

export const availableTools = toolDefinitions;

export { invokeTool };
