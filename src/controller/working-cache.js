#!/usr/bin/env node

/**
 * WORKING Cache — Memory Protocol Phase 3+
 *
 * Session-active memory with fast access and automatic lifecycle.
 * Completes the four-tier model: DECISIONS > CORE > WORKING > ARCHIVAL
 *
 * Types:
 * - user: Human preferences, context (TTL: permanent until session end)
 * - feedback: Corrections and confirmations (TTL: 7d, auto-promote check)
 * - project: Current work, decisions in progress (TTL: session)
 * - reference: Pointers to external resources (TTL: permanent)
 * - scratch: Ephemeral chain-of-thought (TTL: session, no promotion)
 *
 * @author Gordo (AI participant)
 * @version 0.1.0
 * @session S234
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WORKING_DIR = path.join(__dirname, '../.working');
const CACHE_FILE = path.join(WORKING_DIR, 'cache.json');

// TTL constants (in milliseconds)
const TTL = {
  session: 0, // Cleared at session end
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  permanent: Infinity,
};

// Default TTL by type
const TYPE_TTL = {
  user: 'permanent',
  feedback: '7d',
  project: 'session',
  reference: 'permanent',
  scratch: 'session',
};

// Types eligible for CORE promotion
const PROMOTABLE_TYPES = ['user', 'feedback', 'project', 'reference'];

class WorkingCache {
  constructor(options = {}) {
    this.session = options.session || this._detectSession();
    this._ensureDir();
    this._load();
  }

  _ensureDir() {
    if (!fs.existsSync(WORKING_DIR)) {
      fs.mkdirSync(WORKING_DIR, { recursive: true });
    }
  }

  _detectSession() {
    try {
      const logPath = path.join(__dirname, '../../SESSION_LOG.md');
      const content = fs.readFileSync(logPath, 'utf8');
      const match = content.match(/^## Session (\d+)/m);
      return match ? parseInt(match[1]) : 0;
    } catch {
      return 0;
    }
  }

  _load() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        this.cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      } else {
        this.cache = { session: this.session, items: {}, meta: {} };
      }

      // Check if this is a new session
      if (this.cache.session !== this.session) {
        this._handleSessionChange();
      }
    } catch {
      this.cache = { session: this.session, items: {}, meta: {} };
    }
  }

  _save() {
    this.cache.session = this.session;
    this.cache.meta.updated_at = new Date().toISOString();
    fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2));
  }

  _handleSessionChange() {
    const prevSession = this.cache.session;
    const promotionCandidates = [];

    // Process items from previous session
    for (const [id, item] of Object.entries(this.cache.items)) {
      const ttl = item.ttl || TYPE_TTL[item.type] || 'session';

      if (ttl === 'session') {
        // Session-bound items are cleared
        delete this.cache.items[id];
      } else if (ttl !== 'permanent') {
        // Check TTL expiry
        const ttlMs = TTL[ttl];
        const age = Date.now() - new Date(item.created_at).getTime();
        if (age > ttlMs) {
          // Mark for potential promotion before expiry
          if (PROMOTABLE_TYPES.includes(item.type)) {
            promotionCandidates.push({ id, item, age_days: Math.floor(age / (24 * 60 * 60 * 1000)) });
          }
          delete this.cache.items[id];
        }
      }
    }

    // Record session transition
    this.cache.meta.prev_session = prevSession;
    this.cache.meta.session_changed_at = new Date().toISOString();
    this.cache.meta.promotion_candidates = promotionCandidates;
    this.cache.session = this.session;

    this._save();
  }

  /**
   * Generate unique ID for working memory item
   */
  _generateId(type) {
    const hash = crypto.randomBytes(4).toString('hex');
    return `W-S${this.session}-${type.charAt(0)}-${hash}`;
  }

  /**
   * Add item to WORKING cache
   */
  add(content, options = {}) {
    const {
      type = 'scratch',
      ttl = TYPE_TTL[type] || 'session',
      source_refs = [],
      metadata = {},
    } = options;

    const id = this._generateId(type);
    const now = new Date().toISOString();

    this.cache.items[id] = {
      id,
      type,
      content,
      ttl,
      source_refs,
      session_id: `S${this.session}`,
      created_at: now,
      last_accessed: now,
      access_count: 0,
      metadata,
    };

    this._save();
    return id;
  }

  /**
   * Get item by ID
   */
  get(id) {
    const item = this.cache.items[id];
    if (item) {
      item.last_accessed = new Date().toISOString();
      item.access_count++;
      this._save();
    }
    return item;
  }

  /**
   * Update item content
   */
  update(id, content, metadata = {}) {
    const item = this.cache.items[id];
    if (!item) return null;

    item.content = content;
    item.last_accessed = new Date().toISOString();
    item.metadata = { ...item.metadata, ...metadata };
    this._save();
    return item;
  }

  /**
   * Search WORKING cache by content
   */
  search(query, options = {}) {
    const { type = null, limit = 10 } = options;
    const queryLower = query.toLowerCase();
    const results = [];

    for (const [id, item] of Object.entries(this.cache.items)) {
      if (type && item.type !== type) continue;

      if (item.content.toLowerCase().includes(queryLower)) {
        const matches = (item.content.toLowerCase().match(new RegExp(queryLower, 'g')) || []).length;
        results.push({
          ...item,
          score: Math.min(1, matches * 0.2 + (item.access_count * 0.05)),
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * List all items in WORKING cache
   */
  list(options = {}) {
    const { type = null } = options;
    return Object.values(this.cache.items)
      .filter(item => !type || item.type === type)
      .sort((a, b) => new Date(b.last_accessed) - new Date(a.last_accessed));
  }

  /**
   * Get items that are candidates for CORE promotion
   */
  promotionCandidates() {
    const candidates = [];

    for (const item of Object.values(this.cache.items)) {
      if (!PROMOTABLE_TYPES.includes(item.type)) continue;

      // Score based on access patterns and age
      let score = 0.5;
      score += Math.min(0.2, item.access_count * 0.05); // Access frequency
      score += item.type === 'feedback' ? 0.15 : 0; // Corrections are valuable
      score += item.type === 'user' ? 0.10 : 0; // User preferences persist

      // Content indicators
      const content = item.content.toLowerCase();
      if (/always|never|important/i.test(content)) score += 0.10;
      if (/prefer|like|want/i.test(content)) score += 0.05;

      if (score >= 0.70) {
        candidates.push({ ...item, promotion_score: score });
      }
    }

    return candidates.sort((a, b) => b.promotion_score - a.promotion_score);
  }

  /**
   * Clear all session-bound items (run at session end)
   */
  clearSession() {
    const cleared = [];
    for (const [id, item] of Object.entries(this.cache.items)) {
      if (item.ttl === 'session') {
        cleared.push(id);
        delete this.cache.items[id];
      }
    }
    this._save();
    return cleared;
  }

  /**
   * Get statistics
   */
  stats() {
    const items = Object.values(this.cache.items);
    const byType = {};
    for (const item of items) {
      byType[item.type] = (byType[item.type] || 0) + 1;
    }

    return {
      session: `S${this.session}`,
      total: items.length,
      by_type: byType,
      promotable: this.promotionCandidates().length,
      oldest: items.length > 0 ?
        items.reduce((a, b) => new Date(a.created_at) < new Date(b.created_at) ? a : b).id : null,
    };
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const cache = new WorkingCache();

  switch (args[0]) {
    case 'add':
      if (args[1]) {
        const type = args.find(a => a.startsWith('--type='))?.split('=')[1] || 'scratch';
        const content = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
        const id = cache.add(content, { type });
        console.log(`Added: ${id}`);
      } else {
        console.log('Usage: working-cache.js add <content> [--type=user|feedback|project|reference|scratch]');
      }
      break;

    case 'get':
      if (args[1]) {
        const item = cache.get(args[1]);
        console.log(item ? JSON.stringify(item, null, 2) : 'Not found');
      }
      break;

    case 'search':
      if (args[1]) {
        const results = cache.search(args.slice(1).join(' '));
        console.log(JSON.stringify(results, null, 2));
      }
      break;

    case 'list':
      const type = args.find(a => a.startsWith('--type='))?.split('=')[1];
      const items = cache.list({ type });
      console.log('\nWORKING Cache Items\n');
      for (const item of items) {
        console.log(`[${item.type}] ${item.id}`);
        console.log(`  ${item.content.substring(0, 60)}...`);
      }
      break;

    case 'promote':
      const candidates = cache.promotionCandidates();
      console.log('\nPromotion Candidates\n');
      for (const c of candidates) {
        console.log(`[${c.type}] ${c.promotion_score.toFixed(2)} ${c.id}`);
        console.log(`  ${c.content.substring(0, 60)}...`);
      }
      break;

    case 'stats':
      console.log(JSON.stringify(cache.stats(), null, 2));
      break;

    case 'clear':
      const cleared = cache.clearSession();
      console.log(`Cleared ${cleared.length} session-bound items`);
      break;

    default:
      console.log(`
WORKING Cache — Memory Protocol

Commands:
  add <content> [--type=X]    Add item to WORKING cache
  get <id>                    Get item by ID
  search <query>              Search cache contents
  list [--type=X]             List all items
  promote                     Show promotion candidates
  stats                       Cache statistics
  clear                       Clear session-bound items

Types: user, feedback, project, reference, scratch
`);
  }
}

module.exports = WorkingCache;
