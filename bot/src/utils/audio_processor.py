"""Audio processing utilities - uses Gemini for transcription"""

import os
import logging
import ffmpeg
from pathlib import Path

from aiogram import Bot

logger = logging.getLogger(__name__)


async def download_file_from_telegram(bot: Bot, file_id: str) -> str:
    """Download a file from Telegram"""
    ogg_path = "files/input.ogg"
    os.makedirs("files", exist_ok=True)

    # Download Telegram file
    file = await bot.get_file(file_id)
    await bot.download_file(file.file_path, ogg_path)

    return ogg_path


def convert_ogg_to_wav(ogg_path: str, wav_path: str = "files/input.wav") -> str:
    """Convert OGG audio to WAV format for better compatibility"""
    try:
        (
            ffmpeg
            .input(ogg_path)
            .output(wav_path, ac=1, ar=16000)  # Mono, 16kHz for speech
            .overwrite_output()
            .run(quiet=True)
        )
        return wav_path
    except Exception as e:
        logger.error(f"Failed to convert '{ogg_path}' to WAV: {e}")
        # Return original file if conversion fails
        return ogg_path
