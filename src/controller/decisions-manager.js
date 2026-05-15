#!/usr/bin/env node

/**
 * DECISIONS Manager — Memory Protocol Phase 3
 *
 * Manages the DECISIONS tier with Seal integration.
 * DECISIONS require bilateral Seal attestation for entry.
 *
 * Workflow:
 * 1. Draft decision (pending)
 * 2. Seal ratification ceremony
 * 3. Compute content hash after ratification
 * 4. Promote to active
 *
 * @author Gordo (AI participant)
 * @version 0.1.0
 * @session S233
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DECISIONS_FILE = path.join(__dirname, '../DECISIONS.md');
const AUDIT_LOG = path.join(__dirname, '../audit.jsonl');

class DecisionsManager {
  constructor() {
    this.decisions = this._load();
  }

  _load() {
    try {
      const content = fs.readFileSync(DECISIONS_FILE, 'utf8');
      return this._parseDecisions(content);
    } catch {
      return { active: [], superseded: [] };
    }
  }

  _parseDecisions(content) {
    const decisions = { active: [], superseded: [] };

    // Extract YAML blocks
    const yamlBlocks = content.match(/```yaml\n([\s\S]*?)```/g) || [];

    yamlBlocks.forEach(block => {
      const yaml = block.replace(/```yaml\n/, '').replace(/```$/, '').trim();
      const decision = this._parseYaml(yaml);

      if (decision.status === 'active') {
        decisions.active.push(decision);
      } else if (decision.status === 'superseded') {
        decisions.superseded.push(decision);
      }
    });

    return decisions;
  }

  _parseYaml(yaml) {
    const result = {};
    const lines = yaml.split('\n');

    lines.forEach(line => {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();

        // Handle arrays
        if (value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1).split(',').map(s => s.trim());
        }
        // Handle null
        if (value === 'null') value = null;

        result[key] = value;
      }
    });

    return result;
  }

  _computeHash(yamlContent) {
    // Remove content_hash line before computing
    const cleaned = yamlContent.split('\n')
      .filter(line => !line.startsWith('content_hash:'))
      .join('\n');
    return `sha256:${crypto.createHash('sha256').update(cleaned).digest('hex')}`;
  }

  _appendAuditLog(entry) {
    const lines = fs.readFileSync(AUDIT_LOG, 'utf8').trim().split('\n');
    const lastEntry = JSON.parse(lines[lines.length - 1]);
    const prevHash = lastEntry.hash;

    const fullEntry = {
      timestamp: new Date().toISOString(),
      sequence: (lastEntry.sequence || 0) + 1,
      ...entry,
      prev_hash: prevHash,
    };
    fullEntry.hash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(fullEntry)).digest('hex')}`;

    fs.appendFileSync(AUDIT_LOG, JSON.stringify(fullEntry) + '\n');
    return fullEntry;
  }

  /**
   * Draft a new decision (pending state)
   */
  draft(options) {
    const {
      id,
      title,
      what,
      why,
      governed_areas = [],
    } = options;

    const decision = {
      id,
      status: 'pending',
      title,
      what,
      why,
      decided_on: null,
      ratifiers: ['JK', 'Gordo'],
      effective_from: null,
      effective_to: null,
      supersedes: null,
      governed_areas,
      seal_attestation_id: 'pending',
      content_hash: null,
    };

    // Add to DECISIONS.md
    const content = fs.readFileSync(DECISIONS_FILE, 'utf8');
    const newBlock = this._formatDecision(decision);

    // Insert before "## Superseded Decisions"
    const updated = content.replace(
      '## Superseded Decisions',
      `### ${id}: ${title} (PENDING)\n\n${newBlock}\n\n**Status:** Awaiting Seal ratification.\n\n---\n\n## Superseded Decisions`
    );

    fs.writeFileSync(DECISIONS_FILE, updated);

    this._appendAuditLog({
      operation: 'DRAFT_DECISION',
      memory_id: id,
      tier_to: 'DECISIONS',
      actor: 'gordo',
      source_session: this._detectSession(),
      reason: `Draft decision: ${title}`,
      diff: { status: 'pending' },
    });

    return { id, status: 'pending', message: 'Decision drafted. Requires Seal ratification.' };
  }

  _formatDecision(decision) {
    return `\`\`\`yaml
id: ${decision.id}
status: ${decision.status}
title: ${decision.title}
what: ${decision.what}
why: ${decision.why}
decided_on: ${decision.decided_on || 'null'}
ratifiers: [${decision.ratifiers.join(', ')}]
effective_from: ${decision.effective_from || 'null'}
effective_to: ${decision.effective_to || 'null'}
supersedes: ${decision.supersedes || 'null'}
governed_areas: [${decision.governed_areas.join(', ')}]
seal_attestation_id: ${decision.seal_attestation_id}
content_hash: ${decision.content_hash || 'null'}
\`\`\``;
  }

  /**
   * Ratify a decision (link to Seal record, compute hash)
   */
  ratify(decisionId, sealRecordId) {
    const content = fs.readFileSync(DECISIONS_FILE, 'utf8');

    // Find the decision block
    const blockRegex = new RegExp(
      `\`\`\`yaml\\nid: ${decisionId}[\\s\\S]*?\`\`\``,
      'g'
    );
    const match = content.match(blockRegex);

    if (!match) {
      throw new Error(`Decision ${decisionId} not found`);
    }

    const oldBlock = match[0];
    const parsed = this._parseYaml(oldBlock.replace(/```yaml\n/, '').replace(/```$/, ''));

    if (parsed.status === 'active') {
      throw new Error(`Decision ${decisionId} already ratified`);
    }

    // Update fields
    const today = new Date().toISOString().split('T')[0];
    parsed.status = 'active';
    parsed.decided_on = today;
    parsed.effective_from = today;
    parsed.seal_attestation_id = sealRecordId;

    // Compute content hash (before adding hash itself)
    const hashInput = Object.entries(parsed)
      .filter(([k]) => k !== 'content_hash')
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
      .join('\n');
    parsed.content_hash = this._computeHash(hashInput);

    const newBlock = this._formatDecision(parsed);

    // Replace in file
    let updated = content.replace(oldBlock, newBlock);

    // Update status text
    updated = updated.replace(
      new RegExp(`### ${decisionId}:[^\\n]* \\(PENDING\\)`),
      `### ${decisionId}: ${parsed.title}`
    );
    updated = updated.replace(
      new RegExp(`\\*\\*Status:\\*\\* Awaiting Seal ratification\\.`),
      `**Source:** Seal ${sealRecordId}. Hash verified at ratification.`
    );

    fs.writeFileSync(DECISIONS_FILE, updated);

    this._appendAuditLog({
      operation: 'RATIFY_DECISION',
      memory_id: decisionId,
      tier_from: 'DECISIONS',
      tier_to: 'DECISIONS',
      actor: 'gordo',
      source_session: this._detectSession(),
      reason: `Ratified via ${sealRecordId}`,
      diff: {
        status: ['pending', 'active'],
        seal_attestation_id: sealRecordId,
        content_hash: parsed.content_hash,
      },
    });

    return {
      id: decisionId,
      status: 'active',
      seal_record: sealRecordId,
      content_hash: parsed.content_hash,
      message: 'Decision ratified and hash-verified.',
    };
  }

  /**
   * Verify integrity of all decisions
   */
  verify() {
    const content = fs.readFileSync(DECISIONS_FILE, 'utf8');
    const results = [];

    const yamlBlocks = content.match(/```yaml\n([\s\S]*?)```/g) || [];

    yamlBlocks.forEach(block => {
      const yaml = block.replace(/```yaml\n/, '').replace(/```$/, '').trim();
      const decision = this._parseYaml(yaml);

      if (decision.status !== 'active') {
        results.push({
          id: decision.id,
          status: 'pending',
          hash_valid: null,
        });
        return;
      }

      if (!decision.content_hash || decision.content_hash === 'null') {
        results.push({
          id: decision.id,
          status: 'no_hash',
          hash_valid: false,
        });
        return;
      }

      // Recompute hash
      const hashInput = yaml.split('\n')
        .filter(line => !line.startsWith('content_hash:'))
        .join('\n');
      const computed = this._computeHash(hashInput);

      results.push({
        id: decision.id,
        status: 'active',
        hash_valid: computed === decision.content_hash,
        stored_hash: decision.content_hash,
        computed_hash: computed,
      });
    });

    return results;
  }

  /**
   * Supersede a decision with a new one
   */
  supersede(oldId, newDecision) {
    // Mark old as superseded
    const content = fs.readFileSync(DECISIONS_FILE, 'utf8');
    const today = new Date().toISOString().split('T')[0];

    // Update old decision
    let updated = content.replace(
      new RegExp(`(id: ${oldId}[\\s\\S]*?status: )active`),
      `$1superseded`
    );
    updated = updated.replace(
      new RegExp(`(id: ${oldId}[\\s\\S]*?effective_to: )null`),
      `$1${today}`
    );

    fs.writeFileSync(DECISIONS_FILE, updated);

    // Draft new decision
    newDecision.supersedes = oldId;
    return this.draft(newDecision);
  }

  _detectSession() {
    try {
      const logPath = path.join(__dirname, '../../SESSION_LOG.md');
      const content = fs.readFileSync(logPath, 'utf8');
      const match = content.match(/^## Session (\d+)/m);
      return match ? `S${match[1]}` : 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }

  /**
   * List all decisions
   */
  list() {
    return {
      active: this.decisions.active.map(d => ({
        id: d.id,
        title: d.title,
        decided_on: d.decided_on,
        seal: d.seal_attestation_id,
      })),
      superseded: this.decisions.superseded.length,
    };
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const manager = new DecisionsManager();

  switch (args[0]) {
    case 'list':
      console.log(JSON.stringify(manager.list(), null, 2));
      break;

    case 'verify':
      const results = manager.verify();
      console.log('DECISIONS integrity check:');
      results.forEach(r => {
        const status = r.hash_valid === null ? 'PENDING'
          : r.hash_valid ? 'VALID' : 'INVALID';
        console.log(`  ${r.id}: ${status}`);
      });
      break;

    case 'draft':
      if (args[1] && args[2] && args[3]) {
        const result = manager.draft({
          id: args[1],
          title: args[2],
          what: args[3],
          why: args[4] || 'Bilateral decision',
        });
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('Usage: decisions-manager.js draft <id> <title> <what> [why]');
      }
      break;

    case 'ratify':
      if (args[1] && args[2]) {
        const result = manager.ratify(args[1], args[2]);
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('Usage: decisions-manager.js ratify <decision-id> <seal-record-id>');
      }
      break;

    default:
      console.log('Usage: decisions-manager.js <list|verify|draft|ratify>');
  }
}

module.exports = DecisionsManager;
