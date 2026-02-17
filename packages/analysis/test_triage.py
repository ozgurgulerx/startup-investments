"""Quick test of triage LLM call with larger token budget."""
import asyncio
import os
import json

from openai import AsyncAzureOpenAI
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

cred = DefaultAzureCredential()
token_provider = get_bearer_token_provider(
    cred, "https://cognitiveservices.azure.com/.default"
)
client = AsyncAzureOpenAI(
    azure_ad_token_provider=token_provider,
    api_version=os.environ["AZURE_OPENAI_API_VERSION"],
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
)

TRIAGE_PROMPT = """You are an AI startup intelligence analyst. Given a batch of headlines from a technology publication, score each headline for relevance to:
- AI investment / funding rounds
- AI build patterns (new models, infrastructure, developer tools)
- AI research or strategy (policy, competitive moves, industry shifts)

For each headline, return a JSON object with:
- "index" (int, 0-based position in the input list)
- "score" (int: 0=irrelevant, 1=maybe, 2=relevant, 3=high-priority)
- "reason" (string, <=60 chars explaining the score)
- "entities" (array of key entity names mentioned)
- "topic_tags" (array of 1-3 topic tags from: ai, funding, launch, regulation, infrastructure, developer_tools, research, strategy, competition)

Return a JSON object with key "results" containing an array of these objects.
Only include headlines that appear in the input."""

headlines = {"headlines": [
    {"index": 0, "title": "OpenAI Closes $40 Billion Funding Round Led by SoftBank", "url": "https://example.com/1"},
    {"index": 1, "title": "Anthropic Plans Enterprise AI Agent Platform to Compete With Microsoft", "url": "https://example.com/2"},
    {"index": 2, "title": "Google DeepMind Considers Spinning Out Robotics Division", "url": "https://example.com/3"},
    {"index": 3, "title": "Stripe Acquires AI Fraud Detection Startup for $200 Million", "url": "https://example.com/4"},
]}


async def test():
    deployment = os.environ["AZURE_OPENAI_DEPLOYMENT_NAME"]
    print(f"Using deployment: {deployment}")

    resp = await client.chat.completions.create(
        model=deployment,
        messages=[
            {"role": "system", "content": TRIAGE_PROMPT},
            {"role": "user", "content": json.dumps(headlines)},
        ],
        response_format={"type": "json_object"},
        max_completion_tokens=16384,
    )
    print(f"finish_reason: {resp.choices[0].finish_reason}")
    content = resp.choices[0].message.content
    print(f"content: {content[:1500] if content else '(empty)'}")
    if resp.usage:
        print(f"usage: prompt={resp.usage.prompt_tokens}, completion={resp.usage.completion_tokens}")
        details = getattr(resp.usage, "completion_tokens_details", None)
        if details:
            print(f"reasoning_tokens: {getattr(details, 'reasoning_tokens', 'N/A')}")


asyncio.run(test())
