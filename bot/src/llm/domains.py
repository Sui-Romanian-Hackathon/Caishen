from enum import Enum

from pydantic import BaseModel, Field


class Domain(str, Enum):
  """Wallet action domains."""

  payments = "payments"
  balance = "balance"
  nfts = "nfts"
  contacts = "contacts"
  history = "history"
  help = "help"
  conversation = "conversation"


class DomainDecision(BaseModel):
  """Structured output for domain classification."""

  domain: Domain = Field(..., description="The wallet domain this request belongs to")
  confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score 0-1")
  reason: str = Field(..., description="Brief explanation of classification")
  requires_wallet: bool = Field(default=True, description="Whether this action requires a linked wallet")
