#!/usr/bin/env node

/**
 * Memory Controller — Phase 1 Implementation
 *
 * Core operations: ADD, UPDATE, SUPERSEDE, PROMOTE, DEMOTE
 * Integrates with Claude auto-memory at ~/.claude/projects/<project>/memory/
 * All operations logged to audit.jsonl
 *
 * @author Gordo (AI participant)
 * @version 0.1.0
 * @session S233
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Default paths
const DEFAULT_MEMORY_DIR = path.join(
  process.env.HOME,
  '.claude/projects/-home-jk-project-gordo-backchannel/memory'
);
const DEFAULT_AUDIT_LOG = path.join(__dirname, '..', 'audit.jsonl');

class MemoryController {
  constructor(options = {}) {
    this.memoryDir = options.memoryDir || DEFAULT_MEMORY_DIR;
    this.auditLog = options.auditLog || DEFAULT_AUDIT_LOG;
    this.actor = options.actor || 'gordo';
    this.session = options.session || this._detectSession();
  }

  _detectSession() {
    // Try to detect current session from SESSION_LOG.md
    try {
      const logPath = path.join(__dirname, '../../SESSION_LOG.md');
      const content = fs.readFileSync(logPath, 'utf8');
      const match = content.match(/^## Session (\d+)/m);
      return match ? `S${match[1]}` : 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }

  _computeHash(content) {
    return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
  }

  _getLastHash() {
    try {
      const lines = fs.readFileSync(this.auditLog, 'utf8').trim().split('\n');
      if (lines.length === 0) return 'genesis';
      const lastEntry = JSON.parse(lines[lines.length - 1]);
      return lastEntry.hash;
    } catch {
      return 'genesis';
    }
  }

  _appendAuditLog(entry) {
    const prevHash = this._getLastHash();
    const fullEntry = {
      timestamp: new Date().toISOString(),
      sequence: this._getNextSequence(),
      ...entry,
      actor: this.actor,
      source_session: this.session,
      prev_hash: prevHash,
    };
    fullEntry.hash = this._computeHash(JSON.stringify(fullEntry));
    fs.appendFileSync(this.auditLog, JSON.stringify(fullEntry) + '\n');
    return fullEntry;
  }

  _getNextSequence() {
    try {
      const lines = fs.readFileSync(this.auditLog, 'utf8').trim().split('\n');
      if (lines.length === 0) return 0;
      const lastEntry = JSON.parse(lines[lines.length - 1]);
      return (lastEntry.sequence || 0) + 1;
    } catch {
      return 0;
    }
  }

  _readMemoryIndex() {
    const indexPath = path.join(this.memoryDir, 'MEMORY.md');
    try {
      return fs.readFileSync(indexPath, 'utf8');
    } catch {
      return '';
    }
  }

  _writeMemoryIndex(content) {
    const indexPath = path.join(this.memoryDir, 'MEMORY.md');
    fs.writeFileSync(indexPath, content);
  }

  _parseMemoryFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) return null;

      // Simple YAML parsing for our schema
      const yaml = match[1];
      const body = match[2].trim();
      const meta = {};

      yaml.split('\n').forEach(line => {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim();
          let value = line.slice(colonIdx + 1).trim();
          // Handle arrays
          if (value.startsWith('[') && value.endsWith(']')) {
            value = value.slice(1, -1).split(',').map(s => s.trim());
          }
          // Handle booleans
          if (value === 'true') value = true;
          if (value === 'false') value = false;
          // Handle null
          if (value === 'null') value = null;
          // Handle numbers
          if (/^\d+\.?\d*$/.test(value)) value = parseFloat(value);
          meta[key] = value;
        }
      });

      return { meta, body, raw: content };
    } catch {
      return null;
    }
  }

  _generateId(type = 'C') {
    // Find highest existing ID
    const files = fs.readdirSync(this.memoryDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
    let maxNum = 0;
    files.forEach(f => {
      const match = f.match(/^[a-z]+_.*?(\d+)?\.md$/);
      // For now, use timestamp-based ID
    });
    return `${type}-${Date.now()}`;
  }

  _computeSalience(memory) {
    // Simplified salience scoring for Phase 1
    // Full algorithm in Phase 2
    const weights = {
      pinned: 0.20,
      recency: 0.15,
      stated: 0.25,
      type_user: 0.10,
      type_feedback: 0.15,
    };

    let score = 0.5; // Base

    if (memory.pinned) score += weights.pinned;
    if (memory.source_type === 'stated') score += weights.stated;
    if (memory.type === 'user') score += weights.type_user;
    if (memory.type === 'feedback') score += weights.type_feedback;

    // Recency boost (last 7 days = full boost)
    if (memory.created_at) {
      const daysOld = (Date.now() - new Date(memory.created_at).getTime()) / (1000 * 60 * 60 * 24);
      const recencyFactor = Math.max(0, 1 - daysOld / 30);
      score += weights.recency * recencyFactor;
    }

    return Math.min(1.0, Math.max(0.0, score));
  }

  /**
   * ADD - Create new memory entry
   */
  add(options) {
    const {
      type,        // user | feedback | project | reference
      name,        // kebab-case slug
      description, // one-line summary
      body,        // full content
      source_type = 'stated',
      source_refs = [],
      pinned = false,
      confidence = null,
    } = options;

    if (!type || !name || !description) {
      throw new Error('Required: type, name, description');
    }

    const id = `C-${Date.now()}`;
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    const memory = {
      name,
      description,
      type,
      source_type,
      source_refs,
      confidence: confidence || (source_type === 'stated' ? 0.95 : 0.70),
      pinned,
      salience_score: 0,
      validity_start: today,
      validity_end: null,
      created_at: now,
      updated_at: now,
    };

    memory.salience_score = this._computeSalience(memory);

    // Build memory file content
    const filename = `${type}_${name}.md`;
    const filePath = path.join(this.memoryDir, filename);

    const frontmatter = `---
name: ${name}
description: ${description}
metadata:
  type: ${type}
  id: ${id}
  source_type: ${source_type}
  source_refs: [${source_refs.join(', ')}]
  confidence: ${memory.confidence}
  pinned: ${pinned}
  salience_score: ${memory.salience_score.toFixed(2)}
  validity_start: ${today}
  validity_end: null
  created_at: ${now}
  updated_at: ${now}
---

${body || description}`;

    fs.writeFileSync(filePath, frontmatter);

    // Update MEMORY.md index
    this._addToIndex(name, filename, description);

    // Log to audit
    this._appendAuditLog({
      operation: 'ADD',
      memory_id: id,
      tier_to: 'CORE',
      reason: options.reason || 'New memory added',
      diff: { file: filename },
    });

    return { id, filename, salience_score: memory.salience_score };
  }

  _addToIndex(name, filename, description) {
    let index = this._readMemoryIndex();
    const entry = `- [${name}](${filename}) — ${description}`;

    if (index.includes(`](${filename})`)) {
      // Already in index, update it
      const regex = new RegExp(`^- \\[.*?\\]\\(${filename}\\).*$`, 'm');
      index = index.replace(regex, entry);
    } else {
      // Add to end
      index = index.trimEnd() + '\n' + entry + '\n';
    }

    this._writeMemoryIndex(index);
  }

  /**
   * UPDATE - Modify existing memory
   */
  update(filename, updates) {
    const filePath = path.join(this.memoryDir, filename);
    const existing = this._parseMemoryFile(filePath);

    if (!existing) {
      throw new Error(`Memory not found: ${filename}`);
    }

    const now = new Date().toISOString();
    const newMeta = { ...existing.meta.metadata, ...updates, updated_at: now };

    // Rebuild file
    const frontmatter = `---
name: ${existing.meta.name}
description: ${updates.description || existing.meta.description}
metadata:
  type: ${newMeta.type || existing.meta.metadata?.type}
  id: ${newMeta.id || existing.meta.metadata?.id}
  source_type: ${newMeta.source_type}
  source_refs: [${(newMeta.source_refs || []).join(', ')}]
  confidence: ${newMeta.confidence}
  pinned: ${newMeta.pinned}
  salience_score: ${newMeta.salience_score}
  validity_start: ${newMeta.validity_start}
  validity_end: ${newMeta.validity_end}
  created_at: ${newMeta.created_at}
  updated_at: ${now}
---

${updates.body || existing.body}`;

    fs.writeFileSync(filePath, frontmatter);

    // Log to audit
    this._appendAuditLog({
      operation: 'UPDATE',
      memory_id: newMeta.id || filename,
      tier_from: 'CORE',
      tier_to: 'CORE',
      reason: updates.reason || 'Memory updated',
      diff: updates,
    });

    return { filename, updated_at: now };
  }

  /**
   * SUPERSEDE - Replace old memory with new
   */
  supersede(oldFilename, newOptions) {
    const oldPath = path.join(this.memoryDir, oldFilename);
    const existing = this._parseMemoryFile(oldPath);

    if (!existing) {
      throw new Error(`Memory not found: ${oldFilename}`);
    }

    const now = new Date().toISOString();
    const today = now.split('T')[0];

    // Mark old as ended
    this.update(oldFilename, {
      validity_end: today,
      reason: `Superseded by ${newOptions.name}`,
    });

    // Create new
    const result = this.add({
      ...newOptions,
      source_refs: [...(newOptions.source_refs || []), `supersedes:${oldFilename}`],
      reason: `Supersedes ${oldFilename}`,
    });

    // Log supersession
    this._appendAuditLog({
      operation: 'SUPERSEDE',
      memory_id: result.id,
      reason: newOptions.reason || `Superseded ${oldFilename}`,
      diff: { old: oldFilename, new: result.filename },
    });

    return result;
  }

  /**
   * PROMOTE - Move from WORKING to CORE
   *
   * Takes a WORKING tier item and creates a CORE memory file.
   * Removes from WORKING cache after successful promotion.
   */
  promote(workingId, options = {}) {
    const WorkingCache = require('./working-cache');
    const cache = new WorkingCache();

    // Get the working item
    const item = cache.get(workingId);
    if (!item) {
      throw new Error(`WORKING item not found: ${workingId}`);
    }

    // Generate a name from the content
    const name = options.name || this._generateNameFromContent(item.content);
    const description = options.description || item.content.substring(0, 100);

    // Map working types to memory types
    const typeMap = {
      user: 'user',
      feedback: 'feedback',
      project: 'project',
      reference: 'reference',
      scratch: 'project', // Promote scratch as project
    };

    // Create the CORE memory
    const result = this.add({
      type: typeMap[item.type] || 'project',
      name,
      description,
      body: item.content,
      source_type: 'stated',
      source_refs: [item.session_id, `promoted:${workingId}`],
      pinned: false,
      reason: options.reason || `Promoted from WORKING (score: ${options.salience_score || 'N/A'})`,
    });

    // Remove from WORKING cache (mark as promoted)
    cache.cache.items[workingId].promoted_to = result.id;
    cache.cache.items[workingId].promoted_at = new Date().toISOString();
    delete cache.cache.items[workingId];
    cache._save();

    // Log to audit (in addition to ADD log)
    this._appendAuditLog({
      operation: 'PROMOTE',
      memory_id: result.id,
      tier_from: 'WORKING',
      tier_to: 'CORE',
      reason: options.reason || 'Salience threshold met',
      diff: {
        working_id: workingId,
        salience_score: options.salience_score,
        new_file: result.filename,
      },
    });

    return {
      promoted: workingId,
      new_id: result.id,
      filename: result.filename,
      salience_score: result.salience_score,
    };
  }

  /**
   * Generate a kebab-case name from content
   */
  _generateNameFromContent(content) {
    // Take first sentence or first 50 chars
    const first = content.split(/[.!?]/)[0].substring(0, 50);
    // Convert to kebab-case
    return first
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .substring(0, 40);
  }

  /**
   * DEMOTE - Move from CORE to ARCHIVAL
   */
  demote(filename, reason) {
    const filePath = path.join(this.memoryDir, filename);
    const existing = this._parseMemoryFile(filePath);

    if (!existing) {
      throw new Error(`Memory not found: ${filename}`);
    }

    const now = new Date().toISOString();
    const today = now.split('T')[0];

    // Mark as ended (demotion = no longer in CORE)
    this.update(filename, {
      validity_end: today,
      salience_score: 0,
      reason: `Demoted: ${reason}`,
    });

    // Log demotion
    this._appendAuditLog({
      operation: 'DEMOTE',
      memory_id: existing.meta.metadata?.id || filename,
      tier_from: 'CORE',
      tier_to: 'ARCHIVAL',
      reason: reason,
      diff: { file: filename },
    });

    return { demoted: filename, reason };
  }

  /**
   * LIST - Show all CORE memories with salience
   */
  list() {
    const files = fs.readdirSync(this.memoryDir)
      .filter(f => f.endsWith('.md') && f !== 'MEMORY.md');

    return files.map(f => {
      const parsed = this._parseMemoryFile(path.join(this.memoryDir, f));
      if (!parsed) return null;
      return {
        file: f,
        name: parsed.meta.name,
        type: parsed.meta.metadata?.type,
        salience: parsed.meta.metadata?.salience_score,
        valid: !parsed.meta.metadata?.validity_end,
      };
    }).filter(Boolean).sort((a, b) => (b.salience || 0) - (a.salience || 0));
  }

  /**
   * AUDIT - Verify audit log integrity
   */
  verifyAudit() {
    const lines = fs.readFileSync(this.auditLog, 'utf8').trim().split('\n');
    let prevHash = 'genesis';
    const errors = [];

    lines.forEach((line, idx) => {
      try {
        const entry = JSON.parse(line);
        if (entry.prev_hash !== prevHash) {
          errors.push(`Line ${idx + 1}: prev_hash mismatch (expected ${prevHash}, got ${entry.prev_hash})`);
        }
        prevHash = entry.hash;
      } catch (e) {
        errors.push(`Line ${idx + 1}: JSON parse error`);
      }
    });

    return { valid: errors.length === 0, entries: lines.length, errors };
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const controller = new MemoryController();

  switch (command) {
    case 'list':
      console.log(JSON.stringify(controller.list(), null, 2));
      break;
    case 'verify':
      console.log(JSON.stringify(controller.verifyAudit(), null, 2));
      break;
    case 'add':
      // Usage: node memory-controller.js add --type feedback --name test --description "Test memory"
      const opts = {};
      for (let i = 1; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        opts[key] = args[i + 1];
      }
      console.log(JSON.stringify(controller.add(opts), null, 2));
      break;
    default:
      console.log('Usage: memory-controller.js <list|verify|add>');
      console.log('  list              - List all CORE memories');
      console.log('  verify            - Verify audit log integrity');
      console.log('  add --type TYPE --name NAME --description DESC [--body BODY]');
  }
}

module.exports = MemoryController;
