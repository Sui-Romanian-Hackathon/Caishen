import os
from google import genai
from dotenv import load_dotenv
from google.genai import types

load_dotenv()
GEMINI_API_KEY=os.getenv('GEMINI_API_KEY')


def send_money_to_account(name: str, coin: str, amount: float) -> bool:
    """Sends coins to a certain name from contact list.

    Args:
        name: Name of the recepient.
        currency: Name of the coin, e.g., SUI or USD.
        amount: Amount of coins to send

    Returns:
        returns True, if all fields are non-empty
    """
    if name and coin and amount:
        return True
    return False

# Configure the client
client = genai.Client(api_key=GEMINI_API_KEY)
config = types.GenerateContentConfig(
    tools=[send_money_to_account]
)

# Make the request
response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="Send 5 SUI coins to Mircea.",
    config=config,
)

print("\nExample 2: Automatic function calling")
print(response)