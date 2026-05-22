#!/usr/bin/env python3
"""
Conversation extraction pipeline for gordo-ledger.

Wraps EverMemOS's episode and atomic fact extractors to transform
raw session/conversation content into structured, retrievable units.

Usage:
    python extract.py --input session.json --output extracted.json
    echo '{"text": "...", "timestamp": "..."}' | python extract.py

Input JSON:
    {
        "text": "conversation text",
        "timestamp": "2026-05-22T10:00:00Z",
        "session_id": "S336" (optional)
    }

Output JSON:
    {
        "episode": {
            "title": "...",
            "content": "..."
        },
        "atomic_facts": {
            "time": "...",
            "facts": ["...", "..."]
        },
        "metadata": {
            "session_id": "S336",
            "extracted_at": "..."
        }
    }
"""

import sys
import os
import json
import argparse
from datetime import datetime, timezone
from typing import Optional

# Add EverMemOS to path
EVERMEMOS_PATH = "/home/jk/ledger-bench/EverMemOS/methods/EverCore"
sys.path.insert(0, os.path.join(EVERMEMOS_PATH, "src"))

# Import after path setup
from memory_layer.prompts.en.episode_mem_prompts import (
    EPISODE_GENERATION_PROMPT,
    DEFAULT_CUSTOM_INSTRUCTIONS,
)
from memory_layer.prompts.en.atomic_fact_prompts import ATOMIC_FACT_PROMPT


def format_timestamp_for_extraction(iso_timestamp: str) -> str:
    """Convert ISO timestamp to EverMemOS format: 'March 10, 2024(Sunday) at 2:00 PM UTC'"""
    try:
        dt = datetime.fromisoformat(iso_timestamp.replace('Z', '+00:00'))
        weekday = dt.strftime("%A")
        month_day_year = dt.strftime("%B %d, %Y")
        time_of_day = dt.strftime("%I:%M %p")
        return f"{month_day_year}({weekday}) at {time_of_day} UTC"
    except Exception:
        return iso_timestamp


def call_llm(prompt: str, provider: str = "openrouter") -> str:
    """Call LLM via OpenRouter or fallback."""
    import httpx

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY environment variable required")

    response = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": "openai/gpt-4.1-mini",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1,
        },
        timeout=60.0,
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def extract_episode(text: str, timestamp: str) -> dict:
    """Extract episode from conversation text."""
    formatted_time = format_timestamp_for_extraction(timestamp)

    prompt = EPISODE_GENERATION_PROMPT.format(
        conversation_start_time=formatted_time,
        conversation=text,
        custom_instructions=DEFAULT_CUSTOM_INSTRUCTIONS,
    )

    response = call_llm(prompt)

    # Parse JSON from response
    try:
        # Handle potential markdown code blocks
        if "```json" in response:
            response = response.split("```json")[1].split("```")[0]
        elif "```" in response:
            response = response.split("```")[1].split("```")[0]
        return json.loads(response.strip())
    except json.JSONDecodeError:
        return {"title": "Extraction failed", "content": response}


def extract_atomic_facts(text: str, timestamp: str) -> dict:
    """Extract atomic facts from conversation text."""
    formatted_time = format_timestamp_for_extraction(timestamp)

    prompt = ATOMIC_FACT_PROMPT.replace("{{TIME}}", formatted_time).replace(
        "{{INPUT_TEXT}}", text
    )

    response = call_llm(prompt)

    # Parse JSON from response
    try:
        if "```json" in response:
            response = response.split("```json")[1].split("```")[0]
        elif "```" in response:
            response = response.split("```")[1].split("```")[0]
        parsed = json.loads(response.strip())
        return parsed.get("atomic_facts", parsed)
    except json.JSONDecodeError:
        return {"time": formatted_time, "atomic_fact": []}


def extract_conversation(
    text: str,
    timestamp: str,
    session_id: Optional[str] = None,
) -> dict:
    """
    Full extraction pipeline: conversation -> episode + atomic facts.
    """
    episode = extract_episode(text, timestamp)
    atomic_facts = extract_atomic_facts(text, timestamp)

    return {
        "episode": episode,
        "atomic_facts": {
            "time": atomic_facts.get("time", timestamp),
            "facts": atomic_facts.get("atomic_fact", []),
        },
        "metadata": {
            "session_id": session_id,
            "extracted_at": datetime.now(timezone.utc).isoformat() + "Z",
            "extractor_version": "1.0.0",
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Extract episodes and facts from conversations")
    parser.add_argument("--input", "-i", help="Input JSON file (or stdin if omitted)")
    parser.add_argument("--output", "-o", help="Output JSON file (or stdout if omitted)")
    parser.add_argument("--episode-only", action="store_true", help="Only extract episode")
    parser.add_argument("--facts-only", action="store_true", help="Only extract atomic facts")
    args = parser.parse_args()

    # Read input
    if args.input:
        with open(args.input) as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)

    text = data["text"]
    timestamp = data.get("timestamp", datetime.now(timezone.utc).isoformat() + "Z")
    session_id = data.get("session_id")

    # Extract
    if args.episode_only:
        result = {"episode": extract_episode(text, timestamp)}
    elif args.facts_only:
        result = {"atomic_facts": extract_atomic_facts(text, timestamp)}
    else:
        result = extract_conversation(text, timestamp, session_id)

    # Write output
    if args.output:
        with open(args.output, "w") as f:
            json.dump(result, f, indent=2)
    else:
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
