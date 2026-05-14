#!/usr/bin/env node

/**
 * Temporal Store — Memory Protocol Phase 4
 *
 * Bi-temporal query support for point-in-time memory retrieval.
 *
 * Two time dimensions:
 * - valid_time: When fact was true in the world (valid_from, valid_to)
 * - transaction_time: When fact was recorded/superseded (created_at, superseded_at)
 *
 * Query types:
 * - as_of(valid_date): What was true at a given point in time
 * - known_at(transaction_date): What the system knew at a given point
 * - between(start, end): Facts valid within a time range
 * - history(entity): All versions of a fact over time
 *
 * @author Gordo (AI participant)
 * @version 0.1.0
 * @session S234
 */

const fs = require('fs');
const path = require('path');

const MEMORY_DIR = path.join(
  process.env.HOME,
  '.claude/projects/-home-jk-project-gordo-backchannel/memory'
);

class TemporalStore {
  constructor(options = {}) {
    this.memoryDir = options.memoryDir || MEMORY_DIR;
  }

  /**
   * Parse a memory file and extract temporal metadata
   */
  _parseFile(filename) {
    const filePath = path.join(this.memoryDir, filename);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) return null;

      const yaml = match[1];
      const body = match[2].trim();
      const meta = {};

      yaml.split('\n').forEach(line => {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim();
          let value = line.slice(colonIdx + 1).trim();
          if (value === 'null') value = null;
          meta[key] = value;
        }
      });

      return {
        filename,
        name: meta.name,
        description: meta.description,
        type: meta.type || meta['  type'], // Handle nested metadata
        valid_from: meta.validity_start || meta['  validity_start'],
        valid_to: meta.validity_end || meta['  validity_end'],
        created_at: meta.created_at || meta['  created_at'],
        updated_at: meta.updated_at || meta['  updated_at'],
        body,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get all memories with temporal metadata
   */
  _loadAll() {
    const files = fs.readdirSync(this.memoryDir)
      .filter(f => f.endsWith('.md') && f !== 'MEMORY.md');

    return files.map(f => this._parseFile(f)).filter(Boolean);
  }

  /**
   * Parse date string to comparable format (YYYY-MM-DD)
   */
  _parseDate(dateStr) {
    if (!dateStr) return null;
    // Handle ISO dates
    if (dateStr.includes('T')) {
      return dateStr.split('T')[0];
    }
    return dateStr;
  }

  /**
   * Check if a date falls within a validity window
   */
  _isValidAt(memory, date) {
    const queryDate = this._parseDate(date);
    const validFrom = this._parseDate(memory.valid_from);
    const validTo = this._parseDate(memory.valid_to);

    // Must have valid_from
    if (!validFrom) return false;

    // Check lower bound
    if (queryDate < validFrom) return false;

    // Check upper bound (null = still valid)
    if (validTo && queryDate > validTo) return false;

    return true;
  }

  /**
   * AS_OF query: What facts were true at a specific point in time
   */
  asOf(date, options = {}) {
    const { type = null } = options;
    const queryDate = this._parseDate(date);
    const memories = this._loadAll();

    return memories.filter(m => {
      if (type && m.type !== type) return false;
      return this._isValidAt(m, queryDate);
    }).map(m => ({
      name: m.name,
      description: m.description,
      type: m.type,
      valid_from: m.valid_from,
      valid_to: m.valid_to,
      filename: m.filename,
    }));
  }

  /**
   * KNOWN_AT query: What the system knew at a specific transaction time
   */
  knownAt(transactionDate, options = {}) {
    const { type = null } = options;
    const queryDate = this._parseDate(transactionDate);
    const memories = this._loadAll();

    return memories.filter(m => {
      if (type && m.type !== type) return false;

      const createdAt = this._parseDate(m.created_at);
      if (!createdAt) return false;

      // Must have been created by the query date
      return createdAt <= queryDate;
    }).map(m => ({
      name: m.name,
      description: m.description,
      type: m.type,
      created_at: m.created_at,
      filename: m.filename,
    }));
  }

  /**
   * BETWEEN query: Facts valid within a time range
   */
  between(startDate, endDate, options = {}) {
    const { type = null } = options;
    const start = this._parseDate(startDate);
    const end = this._parseDate(endDate);
    const memories = this._loadAll();

    return memories.filter(m => {
      if (type && m.type !== type) return false;

      const validFrom = this._parseDate(m.valid_from);
      const validTo = this._parseDate(m.valid_to);

      if (!validFrom) return false;

      // Overlaps if: validFrom <= end AND (validTo >= start OR validTo is null)
      const startsBeforeEnd = validFrom <= end;
      const endsAfterStart = !validTo || validTo >= start;

      return startsBeforeEnd && endsAfterStart;
    }).map(m => ({
      name: m.name,
      description: m.description,
      type: m.type,
      valid_from: m.valid_from,
      valid_to: m.valid_to,
      filename: m.filename,
    }));
  }

  /**
   * HISTORY query: Timeline of changes for a concept
   */
  history(namePattern) {
    const memories = this._loadAll();
    const pattern = namePattern.toLowerCase();

    // Find all memories matching the pattern
    const matches = memories.filter(m =>
      m.name?.toLowerCase().includes(pattern) ||
      m.description?.toLowerCase().includes(pattern)
    );

    // Sort by creation date
    matches.sort((a, b) => {
      const dateA = this._parseDate(a.created_at) || '0';
      const dateB = this._parseDate(b.created_at) || '0';
      return dateA.localeCompare(dateB);
    });

    return matches.map(m => ({
      name: m.name,
      description: m.description,
      created_at: m.created_at,
      valid_from: m.valid_from,
      valid_to: m.valid_to,
      filename: m.filename,
      current: !m.valid_to,
    }));
  }

  /**
   * SUPERSESSION_CHAIN query: Find supersession lineage
   */
  supersessionChain(filename) {
    const memories = this._loadAll();
    const chain = [];
    let current = memories.find(m => m.filename === filename);

    if (!current) return [];

    chain.push(current);

    // Look backwards: what did this supersede?
    for (const m of memories) {
      if (m.body?.includes(`supersedes:${filename}`) ||
          m.body?.includes(`Supersedes ${current.name}`)) {
        chain.unshift(m);
      }
    }

    // Look forwards: what supersedes this?
    for (const m of memories) {
      const currentBody = current.body || '';
      if (currentBody.includes(`supersedes:${m.filename}`) ||
          currentBody.includes(`Supersedes ${m.name}`)) {
        chain.push(m);
      }
    }

    return chain.map(m => ({
      name: m.name,
      filename: m.filename,
      valid_from: m.valid_from,
      valid_to: m.valid_to,
      current: !m.valid_to,
    }));
  }

  /**
   * TIMELINE query: Aggregate view of memory creation over time
   */
  timeline(options = {}) {
    const { granularity = 'day' } = options;
    const memories = this._loadAll();
    const timeline = {};

    for (const m of memories) {
      let date = this._parseDate(m.created_at);
      if (!date) continue;

      // Granularity adjustment
      if (granularity === 'month') {
        date = date.substring(0, 7); // YYYY-MM
      } else if (granularity === 'week') {
        // Approximate: use first 3 chars of day to get week grouping
        date = date.substring(0, 8) + '0'; // Round to nearest 10-day
      }

      if (!timeline[date]) {
        timeline[date] = { count: 0, types: {} };
      }
      timeline[date].count++;
      const type = m.type || 'unknown';
      timeline[date].types[type] = (timeline[date].types[type] || 0) + 1;
    }

    // Convert to sorted array
    return Object.entries(timeline)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data }));
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const store = new TemporalStore();

  switch (args[0]) {
    case 'as-of':
      if (args[1]) {
        const results = store.asOf(args[1]);
        console.log(`\nFacts valid as of ${args[1]}:\n`);
        results.forEach(r => {
          console.log(`[${r.type || '?'}] ${r.name}`);
          console.log(`  ${r.description?.substring(0, 60)}...`);
        });
        console.log(`\nTotal: ${results.length}`);
      } else {
        console.log('Usage: temporal-store.js as-of <YYYY-MM-DD>');
      }
      break;

    case 'known-at':
      if (args[1]) {
        const results = store.knownAt(args[1]);
        console.log(`\nFacts known at ${args[1]}:\n`);
        results.forEach(r => {
          console.log(`[${r.type || '?'}] ${r.name} (created: ${r.created_at?.split('T')[0]})`);
        });
        console.log(`\nTotal: ${results.length}`);
      }
      break;

    case 'between':
      if (args[1] && args[2]) {
        const results = store.between(args[1], args[2]);
        console.log(`\nFacts valid between ${args[1]} and ${args[2]}:\n`);
        results.forEach(r => {
          const validity = r.valid_to ? `${r.valid_from} to ${r.valid_to}` : `${r.valid_from} to present`;
          console.log(`[${r.type || '?'}] ${r.name}`);
          console.log(`  Valid: ${validity}`);
        });
        console.log(`\nTotal: ${results.length}`);
      }
      break;

    case 'history':
      if (args[1]) {
        const results = store.history(args.slice(1).join(' '));
        console.log(`\nHistory of "${args.slice(1).join(' ')}":\n`);
        results.forEach(r => {
          const status = r.current ? '●' : '○';
          console.log(`${status} ${r.created_at?.split('T')[0] || '?'} ${r.name}`);
        });
      }
      break;

    case 'timeline':
      const granularity = args[1] || 'day';
      const timeline = store.timeline({ granularity });
      console.log(`\nMemory Timeline (${granularity}):\n`);
      timeline.slice(-20).forEach(t => { // Last 20 entries
        const types = Object.entries(t.types).map(([k, v]) => `${k}:${v}`).join(' ');
        console.log(`${t.date}: ${t.count} (${types})`);
      });
      break;

    default:
      console.log(`
Temporal Store — Memory Protocol Phase 4

Commands:
  as-of <date>              Facts valid at a point in time
  known-at <date>           Facts known to system at a point
  between <start> <end>     Facts valid within a range
  history <pattern>         Timeline of a concept
  timeline [day|month]      Aggregate view of memory creation

Examples:
  temporal-store.js as-of 2026-05-01
  temporal-store.js between 2026-04-01 2026-05-01
  temporal-store.js history "Tool Sovereignty"
  temporal-store.js timeline month
`);
  }
}

module.exports = TemporalStore;
