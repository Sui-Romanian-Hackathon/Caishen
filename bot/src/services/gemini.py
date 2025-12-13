"""Gemini AI service for chat and audio transcription"""

import logging
import base64
from typing import Optional, Dict, Any, List
from pathlib import Path

from google import genai
from google.genai import types

from src.core import settings

logger = logging.getLogger(__name__)


class GeminiService:
    """Handles all Gemini AI interactions including audio transcription and chat"""

    def __init__(self):
        self.client = genai.Client(api_key=settings.GOOGLE_AI_API_KEY)
        self.model = settings.GEMINI_MODEL

        # System prompt for the wallet assistant
        self.system_prompt = """You are an AI assistant for a Sui blockchain wallet on Telegram.
You help users with:
- Checking their SUI balance
- Sending SUI to addresses or contacts
- Managing contacts (add, list, remove)
- Viewing transaction history
- Understanding their wallet and the Sui blockchain

Be concise and helpful. When users want to send crypto, extract:
- Amount (in SUI)
- Recipient (address starting with 0x, or contact name)

If information is missing, ask for clarification.
Always confirm transaction details before proceeding.

IMPORTANT: You are NOT able to execute transactions directly. You can only help users
prepare transactions that they will sign using their wallet."""

        # Define tools for function calling
        self.tools = [
            types.Tool(function_declarations=[
                types.FunctionDeclaration(
                    name="get_balance",
                    description="Get the SUI balance for the user's wallet",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={},
                    ),
                ),
                types.FunctionDeclaration(
                    name="send_sui",
                    description="Prepare a transaction to send SUI to a recipient",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "amount": types.Schema(
                                type=types.Type.NUMBER,
                                description="Amount of SUI to send",
                            ),
                            "recipient": types.Schema(
                                type=types.Type.STRING,
                                description="Recipient address (0x...) or contact name",
                            ),
                        },
                        required=["amount", "recipient"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="list_contacts",
                    description="List all saved contacts",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={},
                    ),
                ),
                types.FunctionDeclaration(
                    name="add_contact",
                    description="Add a new contact with name and address",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "name": types.Schema(
                                type=types.Type.STRING,
                                description="Contact name/alias",
                            ),
                            "address": types.Schema(
                                type=types.Type.STRING,
                                description="Sui wallet address (0x...)",
                            ),
                        },
                        required=["name", "address"],
                    ),
                ),
                types.FunctionDeclaration(
                    name="get_history",
                    description="Get recent transaction history",
                    parameters=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "limit": types.Schema(
                                type=types.Type.INTEGER,
                                description="Number of transactions to fetch (default 10)",
                            ),
                        },
                    ),
                ),
            ])
        ]

    async def transcribe_audio(self, audio_path: str) -> str:
        """Transcribe audio file using Gemini's multimodal capabilities"""
        try:
            # Read audio file
            audio_file = Path(audio_path)
            if not audio_file.exists():
                raise FileNotFoundError(f"Audio file not found: {audio_path}")

            audio_bytes = audio_file.read_bytes()
            audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')

            # Determine mime type
            suffix = audio_file.suffix.lower()
            mime_types = {
                '.ogg': 'audio/ogg',
                '.wav': 'audio/wav',
                '.mp3': 'audio/mp3',
                '.m4a': 'audio/mp4',
            }
            mime_type = mime_types.get(suffix, 'audio/ogg')

            # Create content with audio
            response = self.client.models.generate_content(
                model=self.model,
                contents=[
                    types.Content(
                        parts=[
                            types.Part(
                                inline_data=types.Blob(
                                    mime_type=mime_type,
                                    data=audio_bytes,
                                )
                            ),
                            types.Part(text="Transcribe this audio message exactly. Output only the transcription, nothing else."),
                        ]
                    )
                ],
            )

            transcription = response.text.strip()
            logger.info(f"Transcribed audio: {transcription[:100]}...")
            return transcription

        except Exception as e:
            logger.error(f"Audio transcription failed: {e}")
            raise

    async def chat(
        self,
        message: str,
        wallet_address: Optional[str] = None,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        """
        Process a chat message and return response with potential function calls.

        Returns:
            {
                "text": str,  # Response text
                "function_call": Optional[Dict],  # If AI wants to call a function
                "intent": Optional[str],  # Detected intent (balance, send, etc.)
            }
        """
        try:
            # Build context
            context_parts = [self.system_prompt]
            if wallet_address:
                context_parts.append(f"\nUser's wallet address: {wallet_address}")
            else:
                context_parts.append("\nUser has NOT linked a wallet yet. Remind them to use /start to connect one.")

            # Build conversation history
            contents = []

            # Add history if provided
            if history:
                for msg in history[-10:]:  # Last 10 messages
                    role = "user" if msg["role"] == "user" else "model"
                    contents.append(types.Content(
                        role=role,
                        parts=[types.Part(text=msg["text"])]
                    ))

            # Add current message
            contents.append(types.Content(
                role="user",
                parts=[types.Part(text=message)]
            ))

            # Generate response with function calling
            response = self.client.models.generate_content(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction="\n".join(context_parts),
                    tools=self.tools,
                    temperature=0.7,
                ),
            )

            result = {
                "text": "",
                "function_call": None,
                "intent": None,
            }

            # Process response
            if response.candidates and response.candidates[0].content.parts:
                for part in response.candidates[0].content.parts:
                    if hasattr(part, 'text') and part.text:
                        result["text"] = part.text
                    if hasattr(part, 'function_call') and part.function_call:
                        fc = part.function_call
                        result["function_call"] = {
                            "name": fc.name,
                            "args": dict(fc.args) if fc.args else {},
                        }
                        result["intent"] = fc.name

            # Fallback if no text
            if not result["text"] and not result["function_call"]:
                result["text"] = "I'm not sure how to help with that. Try /help to see what I can do."

            return result

        except Exception as e:
            logger.error(f"Chat failed: {e}")
            return {
                "text": f"Sorry, I encountered an error: {str(e)}",
                "function_call": None,
                "intent": None,
            }

    async def simple_response(self, prompt: str) -> str:
        """Generate a simple text response without function calling"""
        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=prompt,
            )
            return response.text.strip()
        except Exception as e:
            logger.error(f"Simple response failed: {e}")
            return f"Error: {str(e)}"


# Singleton instance
gemini_service = GeminiService()
