# CORE Tier — Schema Definition

**Version:** 0.1
**Status:** Draft

---

## Overview

The CORE tier stores high-salience operating beliefs curated by the AI participant, inspectable by the human participant. Unlike DECISIONS (bilateral), CORE is AI-managed with human auditability.

## File Format

CORE memories are stored in `MEMORY.md` (human-readable markdown) with YAML frontmatter per entry.

**Location:** `~/.claude/projects/<project>/memory/MEMORY.md` (index) + individual `*.md` files

## Entry Schema

```yaml
---
id: C-042
type: feedback  # user | feedback | project | reference
fact: "JK prefers everyday-English over formal register"
source_type: stated  # stated | inferred | external | system
source_refs:
  - S18
  - S51
confidence: 0.95
governed_by: null  # or D-xxx if decision-governed
validity_start: 2026-04-21
validity_end: null  # null = still valid
pinned: false
salience_score: 0.82
last_reviewed: 2026-05-10
created_at: 2026-04-21T10:30:00Z
updated_at: 2026-05-10T14:00:00Z
---

JK prefers everyday-English over formal register.

**Why:** Default to everyday-English over formal/CS-academic register when both work.

**Source:** S18 first instance, S51 reinforced.
```

## Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier, format `C-NNN` |
| `type` | enum | Yes | user, feedback, project, reference |
| `fact` | string | Yes | The memory content (one line) |
| `source_type` | enum | Yes | stated, inferred, external, system |
| `source_refs` | array | Yes | Sessions/issues where this originated |
| `confidence` | float | Yes | 0.0-1.0, required for inferred |
| `governed_by` | string | No | Decision ID if governed |
| `validity_start` | date | Yes | When this became true |
| `validity_end` | date | No | When this stopped being true |
| `pinned` | boolean | Yes | If true, immune to demotion |
| `salience_score` | float | Yes | Current salience (0.0-1.0) |
| `last_reviewed` | date | Yes | Last human/system review |
| `created_at` | ISO 8601 | Yes | When created |
| `updated_at` | ISO 8601 | Yes | When last modified |

## Types

| Type | Description | Typical TTL |
|------|-------------|-------------|
| `user` | Human preferences, context | Long (180d decay) |
| `feedback` | Corrections and confirmations | Medium (90d decay) |
| `project` | Current work, decisions in progress | Short (30d decay) |
| `reference` | Pointers to external resources | Long (180d decay) |

## Source Types

| Source | Description | Confidence Required |
|--------|-------------|-------------------|
| `stated` | Human explicitly said this | Any |
| `inferred` | AI derived from context | ≥ 0.7 for CORE |
| `external` | From external document/API | ≥ 0.8 for CORE |
| `system` | Framework-generated | N/A |

## Promotion Criteria

Entry promoted from WORKING to CORE when:
- `salience_score ≥ 0.75` AND `confidence ≥ 0.7`, OR
- `pinned = true`, OR
- `governed_by` is set (linked to DECISION)

## Demotion Criteria

Entry demoted from CORE to ARCHIVAL when:
- `salience_score ≤ 0.35` AND `pinned = false` AND `governed_by = null`
- Requires audit log entry with rationale

## Size Budget

Target: <12KB total for MEMORY.md index

When approaching limit:
1. Review lowest-salience entries
2. Demote or supersede
3. Run /compress-memory skill

## Operations

| Operation | Requirements |
|-----------|--------------|
| ADD | Salience threshold OR pinned |
| UPDATE | Audit log entry |
| SUPERSEDE | Old entry gets validity_end |
| DEMOTE | Audit log with rationale |

## Human Override

Human can:
- Correct any entry without AI agreement
- Demote any entry with rationale
- Pin/unpin any entry
- Request review of any entry

All overrides logged in audit log.

---

*Schema v0.1 — S232 2026-05-14*

<!-- Last reviewed: 2026-05-26 20:51 AEST by Gordo -->
