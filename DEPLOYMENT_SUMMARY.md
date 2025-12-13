# Deployment Summary — Sui Testnet

- **Package ID:** `0xa7e134eed9b3728fef06aa1cd14a4e6f056c890b28e857afcb3aaeb1cebd17f9`
- **Global Registry ID:** `0x42809277bb22831bd04f8e8c7cf506335d71f5885d3e14c31083a34eaad40bf3`
- **Upgrade Cap:** `0x491c95ce7548443eff5d6072b2aa9a25e8741d9913baaa42e61780e92c8aca16`

Saved in `.env` as:
```
SMART_CONTRACT_PACKAGE_ID=0xa7e134eed9b3728fef06aa1cd14a4e6f056c890b28e857afcb3aaeb1cebd17f9
CONTACT_REGISTRY_ID=0x42809277bb22831bd04f8e8c7cf506335d71f5885d3e14c31083a34eaad40bf3
```

Explorer links:
- Package: https://suiscan.xyz/testnet/object/0xa7e134eed9b3728fef06aa1cd14a4e6f056c890b28e857afcb3aaeb1cebd17f9
- Registry: https://suiscan.xyz/testnet/object/0x42809277bb22831bd04f8e8c7cf506335d71f5885d3e14c31083a34eaad40bf3

Next integration steps:
- Add LLM tool handlers to call `contact_registry::create_contact_book` and `register_public_name`.
- Expose contract IDs in bot replies (e.g., `/contracts`) for quick reference.
