---
paths:
  - "packages/analysis/**"
---

# Python Analysis Package Rules

**LLM Model Policy:** All LLM calls MUST use `gpt-5-nano` via the `AZURE_OPENAI_DEPLOYMENT_NAME` env var. Never hardcode other model names. Use the centralized `AzureOpenAIConfig` in `packages/analysis/src/config.py`.

**`max_completion_tokens` not `max_tokens`** — GPT-5 models reject `max_tokens`. Use `llm_kwargs()` helper from `config.py`.

**Azure OpenAI auth:** Resource `aoai-ep-swedencentral02` has key-based auth DISABLED. Must use `DefaultAzureCredential` (managed identity). Code prefers AAD auth, falls back to API key only if `azure-identity` not installed.

**Python venv:** `/Users/ozgurguler/Developer/Projects/startup-analysis/packages/analysis/venv/bin/python`

**Azure Blob SDK** is synchronous — async wrappers must use `asyncio.to_thread()`.
