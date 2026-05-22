#!/usr/bin/env python3
"""
Gordo-optimized conversation extraction pipeline for gordo-ledger.

v2: Customized for Gordo umbrella session structure with:
- Shorter, search-optimized episode summaries
- Categorized facts (decisions, actions, patterns, references)
- Cross-reference extraction (sessions, issues, commits)
- Metadata enrichment (duration, WWGD level, participants)

Usage:
    python extract_v2.py --input session.json --output extracted.json
    echo '{"text": "...", "timestamp": "..."}' | python extract_v2.py
"""

import sys
import os
import json
import re
import argparse
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

GORDO_EPISODE_PROMPT = """You are extracting a searchable summary from a Gordo umbrella project session log.

Session date: {timestamp}
Session content:
{content}

Generate a JSON response with this exact structure:
{{
    "summary": "2-3 sentence summary of what happened and what was decided. Focus on outcomes, not process.",
    "decisions": ["List of explicit decisions made (ratified, approved, closed, etc.)"],
    "actions": ["List of concrete actions taken (commits, issue changes, file edits)"],
    "patterns": ["Any new patterns, conventions, or methodologies established"],
    "topics": ["3-5 key topic keywords for search (e.g., 'Seal', 'roadmap', 'WWGD', 'extraction')"]
}}

Rules:
1. Be concise - the summary should be 2-3 sentences max
2. Decisions should be specific ("Ratified ROADMAP v0.2" not "discussed roadmap")
3. Actions should name specific artifacts (commit SHAs, issue numbers, file names)
4. Patterns are new conventions or methodologies that will apply going forward
5. Topics are search keywords, not full sentences
6. If a category is empty, use an empty list []
7. Preserve exact issue numbers (#123), session references (S123), and commit SHAs

Return ONLY the JSON object, no other text.
"""

GORDO_FACTS_PROMPT = """Extract structured facts from this Gordo umbrella session for retrieval.

Session date: {timestamp}
Session content:
{content}

Generate a JSON response with categorized atomic facts:
{{
    "who": ["Participants and their roles (e.g., 'JK proposed', 'Gordo drafted')"],
    "what": ["Key events, discussions, and outcomes"],
    "decisions": ["Explicit bilateral decisions with their WWGD level if mentioned"],
    "references": {{
        "sessions": ["S123", "S456"],
        "issues": ["#123", "#456"],
        "commits": ["abc1234"],
        "files": ["ROADMAP_DRAFT.md", "SESSION_LOG.md"]
    }},
    "handoff": ["Items for next session, blocked items, open questions"]
}}

Rules:
1. Each fact should be a single, searchable statement
2. Preserve exact references (S123, #45, commit SHAs)
3. Include WWGD levels when mentioned (WWGD++!!, WWGD+++!!!, etc.)
4. Handoff items are future work explicitly mentioned
5. If a category is empty, use an empty list [] or empty object {{}}

Return ONLY the JSON object, no other text.
"""


def call_llm(prompt: str) -> str:
    """Call LLM via OpenRouter."""
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
        timeout=120.0,
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def parse_json_response(response: str) -> dict:
    """Parse JSON from LLM response, handling markdown code blocks."""
    text = response.strip()
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0]
    elif "```" in text:
        text = text.split("```")[1].split("```")[0]
    return json.loads(text.strip())


def extract_references_regex(text: str) -> Dict[str, List[str]]:
    """Extract references using regex as fallback/supplement to LLM extraction."""
    return {
        "sessions": list(set(re.findall(r'\bS(\d+)\b', text))),
        "issues": list(set(re.findall(r'#(\d+)', text))),
        "commits": list(set(re.findall(r'\b([a-f0-9]{7,40})\b', text))),
        "wwgd_levels": list(set(re.findall(r'WWGD[+!]+', text))),
    }


def extract_metadata(text: str, session_id: str) -> Dict[str, Any]:
    """Extract session metadata from content."""
    metadata = {
        "session_id": session_id,
        "session_number": None,
        "duration_mentioned": None,
        "wwgd_max_level": None,
    }

    # Extract session number
    match = re.search(r'Session[_ ]?(\d+)', session_id)
    if match:
        metadata["session_number"] = int(match.group(1))

    # Find duration if mentioned
    duration_match = re.search(r'(\d+)\s*(?:minutes?|mins?|hours?|hrs?)', text, re.I)
    if duration_match:
        metadata["duration_mentioned"] = duration_match.group(0)

    # Find highest WWGD level (including emoji variants like ♾️)
    wwgd_matches = re.findall(r'WWGD([+!♾️]+)', text)
    if wwgd_matches:
        metadata["wwgd_max_level"] = "WWGD" + max(wwgd_matches, key=len)

    return metadata


def extract_episode_v2(text: str, timestamp: str) -> dict:
    """Extract concise, search-optimized episode summary."""
    prompt = GORDO_EPISODE_PROMPT.format(
        timestamp=timestamp,
        content=text[:15000],  # Truncate very long sessions
    )

    try:
        response = call_llm(prompt)
        return parse_json_response(response)
    except Exception as e:
        return {
            "summary": f"Extraction failed: {e}",
            "decisions": [],
            "actions": [],
            "patterns": [],
            "topics": [],
        }


def extract_facts_v2(text: str, timestamp: str) -> dict:
    """Extract categorized facts for retrieval."""
    prompt = GORDO_FACTS_PROMPT.format(
        timestamp=timestamp,
        content=text[:15000],
    )

    try:
        response = call_llm(prompt)
        facts = parse_json_response(response)

        # Supplement with regex extraction
        regex_refs = extract_references_regex(text)
        if "references" not in facts:
            facts["references"] = {}

        # Merge regex-found references
        for key in ["sessions", "issues", "commits"]:
            if key in regex_refs and regex_refs[key]:
                existing = facts.get("references", {}).get(key, [])
                facts["references"][key] = list(set(existing + regex_refs[key]))

        return facts
    except Exception as e:
        return {
            "who": [],
            "what": [f"Extraction failed: {e}"],
            "decisions": [],
            "references": extract_references_regex(text),
            "handoff": [],
        }


def format_for_indexing(episode: dict, facts: dict, metadata: dict) -> str:
    """Format extracted content for optimal indexing and search."""
    lines = []

    # Header with session info
    if metadata.get("session_number"):
        lines.append(f"# Session {metadata['session_number']} Summary")

    # Concise summary
    if episode.get("summary"):
        lines.append(f"\n{episode['summary']}")

    # Topics as tags
    if episode.get("topics"):
        lines.append(f"\n**Topics:** {', '.join(episode['topics'])}")

    # Decisions section
    if episode.get("decisions"):
        lines.append("\n## Decisions")
        for d in episode["decisions"]:
            lines.append(f"- {d}")

    # Actions section
    if episode.get("actions"):
        lines.append("\n## Actions")
        for a in episode["actions"]:
            lines.append(f"- {a}")

    # Patterns section
    if episode.get("patterns"):
        lines.append("\n## Patterns Established")
        for p in episode["patterns"]:
            lines.append(f"- {p}")

    # Key facts (selective)
    if facts.get("decisions"):
        lines.append("\n## Key Facts")
        for f in facts["decisions"][:10]:  # Limit to top 10
            lines.append(f"- {f}")

    # References section - dedupe first
    refs = facts.get("references", {})

    # Clean up session references (remove duplicates like S332 vs 332)
    if refs.get("sessions"):
        clean_sessions = set()
        for s in refs["sessions"]:
            num = s.lstrip("S")
            if num.isdigit():
                clean_sessions.add(num)
        refs["sessions"] = sorted(clean_sessions, key=lambda x: int(x))

    # Clean up issue references
    if refs.get("issues"):
        clean_issues = set()
        for i in refs["issues"]:
            num = i.lstrip("#")
            if num.isdigit():
                clean_issues.add(num)
        refs["issues"] = sorted(clean_issues, key=lambda x: int(x))

    ref_parts = []
    if refs.get("sessions"):
        ref_parts.append(f"Sessions: {', '.join('S' + s for s in refs['sessions'][:10])}")
    if refs.get("issues"):
        ref_parts.append(f"Issues: {', '.join('#' + i for i in refs['issues'][:10])}")
    if ref_parts:
        lines.append(f"\n**References:** {' | '.join(ref_parts)}")

    # Handoff section
    if facts.get("handoff"):
        lines.append("\n## Handoff")
        for h in facts["handoff"]:
            lines.append(f"- {h}")

    # Metadata footer
    if metadata.get("wwgd_max_level"):
        lines.append(f"\n*Max autonomy: {metadata['wwgd_max_level']}*")

    return "\n".join(lines)


def extract_conversation_v2(
    text: str,
    timestamp: str,
    session_id: Optional[str] = None,
) -> dict:
    """Full v2 extraction pipeline."""
    metadata = extract_metadata(text, session_id or "unknown")
    episode = extract_episode_v2(text, timestamp)
    facts = extract_facts_v2(text, timestamp)

    # Format for indexing
    formatted_content = format_for_indexing(episode, facts, metadata)

    return {
        "episode": episode,
        "facts": facts,
        "metadata": {
            **metadata,
            "extracted_at": datetime.now(timezone.utc).isoformat(),
            "extractor_version": "2.0.0",
        },
        "formatted_content": formatted_content,
    }


def main():
    parser = argparse.ArgumentParser(description="Gordo-optimized conversation extraction v2")
    parser.add_argument("--input", "-i", help="Input JSON file (or stdin if omitted)")
    parser.add_argument("--output", "-o", help="Output JSON file (or stdout if omitted)")
    parser.add_argument("--format-only", action="store_true", help="Output formatted content only")
    args = parser.parse_args()

    # Read input
    if args.input:
        with open(args.input) as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)

    text = data["text"]
    timestamp = data.get("timestamp", datetime.now(timezone.utc).isoformat())
    session_id = data.get("session_id")

    # Extract
    result = extract_conversation_v2(text, timestamp, session_id)

    # Output
    if args.format_only:
        output = result["formatted_content"]
    else:
        output = json.dumps(result, indent=2)

    if args.output:
        with open(args.output, "w") as f:
            f.write(output)
    else:
        print(output)


if __name__ == "__main__":
    main()
