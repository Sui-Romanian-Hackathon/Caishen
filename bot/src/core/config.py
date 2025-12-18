import os
from pathlib import Path
from pydantic_settings import BaseSettings
from pydantic import Field, ConfigDict
from dotenv import load_dotenv

# Load root .env file (parent of bot directory)
root_env = Path(__file__).parent.parent.parent.parent / ".env"
load_dotenv(root_env)


class Settings(BaseSettings):
    """Application settings - uses root .env file"""

    model_config = ConfigDict(
        case_sensitive=True,
        extra="ignore"
    )

    # Telegram Bot (mapped from root .env names)
    TELEGRAM_BOT_TOKEN: str = Field(default="", alias="TELEGRAM_BOT_TOKEN")
    TELEGRAM_WEBHOOK_SECRET: str = Field(default="", alias="TELEGRAM_WEBHOOK_SECRET")
    WEBHOOK_BASE_URL: str = Field(default="https://caishen.iseethereaper.com")

    # Server
    PORT: int = Field(default=3001)
    WEBHOOK_PATH: str = Field(default="/webhook")

    # LLM (Gemini)
    GOOGLE_AI_API_KEY: str = Field(default="")
    GEMINI_MODEL: str = Field(default="gemini-2.0-flash")

    # PostgreSQL Database
    POSTGRES_HOST: str = Field(default="postgres")
    POSTGRES_PORT: int = Field(default=5432)
    POSTGRES_USER: str = Field(default="caishen")
    POSTGRES_PASSWORD: str = Field(default="")
    POSTGRES_DB: str = Field(default="caishen_wallet")

    # Sui Network
    SUI_RPC_URL: str = Field(default="https://fullnode.testnet.sui.io:443")
    SUI_NETWORK: str = Field(default="testnet")

    # Smart Contracts
    SMART_CONTRACT_PACKAGE_ID: str = Field(default="")
    CONTACT_REGISTRY_ID: str = Field(default="")

    # Web App
    WEBAPP_URL: str = Field(default="https://caishen.iseethereaper.com")

    # zkLogin
    ZKLOGIN_SALT_SERVICE_URL: str = Field(default="https://salt.api.mystenlabs.com/get_salt")
    ZKLOGIN_PROVER_URL: str = Field(default="https://prover-dev.mystenlabs.com/v1")
    GOOGLE_CLIENT_ID: str = Field(default="")

    # Internal Services
    TX_SERVICE_URL: str = Field(default="http://zklogin-transaction-builder:3003")

    @property
    def TG_BOT_TOKEN(self) -> str:
        """Alias for compatibility"""
        return self.TELEGRAM_BOT_TOKEN

    @property
    def WEBHOOK_SECRET(self) -> str:
        """Alias for compatibility"""
        return self.TELEGRAM_WEBHOOK_SECRET

    @property
    def database_url(self) -> str:
        return f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"


settings = Settings()
