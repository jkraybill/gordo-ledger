#!/usr/bin/env node

/**
 * Salience Cache — Memory Protocol Phase 2
 *
 * Tracks computed salience, access patterns, and lifecycle metadata
 * for memories without modifying the memory files themselves.
 *
 * Cache stored as JSON for fast read/write, separate from memory content.
 *
 * @author Gordo (AI participant)
 * @version 0.1.0
 * @session S233
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CACHE_PATH = path.join(__dirname, '../.salience-cache.json');

class SalienceCache {
  constructor(cachePath = DEFAULT_CACHE_PATH) {
    this.cachePath = cachePath;
    this.cache = this._load();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
    } catch {
      return {
        version: '0.1.0',
        created_at: new Date().toISOString(),
        entries: {},
      };
    }
  }

  _save() {
    this.cache.updated_at = new Date().toISOString();
    fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
  }

  /**
   * Get or create cache entry for a memory
   */
  getEntry(memoryFile) {
    if (!this.cache.entries[memoryFile]) {
      this.cache.entries[memoryFile] = {
        salience_score: null,
        last_computed: null,
        access_count: 0,
        last_accessed: null,
        created_at: new Date().toISOString(),
        pinned: false,
        decay_rate: 'normal', // slow | normal | fast
      };
    }
    return this.cache.entries[memoryFile];
  }

  /**
   * Record an access to a memory
   */
  recordAccess(memoryFile) {
    const entry = this.getEntry(memoryFile);
    entry.access_count++;
    entry.last_accessed = new Date().toISOString();
    this._save();
    return entry;
  }

  /**
   * Compute and store salience for a memory
   */
  computeSalience(memoryFile, memoryContent = {}) {
    const entry = this.getEntry(memoryFile);
    const now = new Date();

    // Weights from PRD
    const W = {
      relevance: 0.35,   // We can't compute this without context, use base
      recency: 0.15,
      importance: 0.25,
      frequency: 0.15,
      pinned: 0.20,
      stale: -0.10,
    };

    let score = 0.5; // Base relevance (context-dependent, use neutral)

    // Recency factor
    if (entry.created_at) {
      const ageMs = now - new Date(entry.created_at);
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const decayTau = this._getDecayTau(memoryFile, memoryContent);
      const recencyFactor = Math.exp(-ageDays / decayTau);
      score += W.recency * recencyFactor;
    }

    // Importance (from content analysis)
    const importance = this._estimateImportance(memoryContent);
    score += W.importance * importance;

    // Frequency factor (log of access count)
    if (entry.access_count > 0) {
      const freqFactor = Math.log(entry.access_count + 1) / Math.log(100);
      score += W.frequency * Math.min(1, freqFactor);
    }

    // Pinned bonus
    if (entry.pinned) {
      score += W.pinned;
    }

    // Staleness penalty
    if (entry.last_accessed) {
      const staleMs = now - new Date(entry.last_accessed);
      const staleDays = staleMs / (1000 * 60 * 60 * 24);
      if (staleDays > 30) {
        const staleFactor = Math.min(1, (staleDays - 30) / 60);
        score += W.stale * staleFactor;
      }
    }

    score = Math.max(0, Math.min(1, score));

    entry.salience_score = parseFloat(score.toFixed(3));
    entry.last_computed = now.toISOString();
    this._save();

    return entry.salience_score;
  }

  _getDecayTau(memoryFile, memoryContent) {
    // Type-specific decay constants from PRD
    const DECAY_TAU = {
      user: 180,
      feedback: 90,
      project: 30,
      reference: 180,
    };

    // Extract type from filename or content
    let type = 'feedback'; // default
    if (memoryFile.startsWith('user_')) type = 'user';
    else if (memoryFile.startsWith('project_')) type = 'project';
    else if (memoryFile.startsWith('reference_')) type = 'reference';
    else if (memoryContent.type) type = memoryContent.type;

    return DECAY_TAU[type] || 90;
  }

  _estimateImportance(memoryContent) {
    // Simple heuristic based on content signals
    let importance = 0.5;

    const text = JSON.stringify(memoryContent).toLowerCase();

    // High importance markers
    const highMarkers = [
      'inviolable', 'absolute', 'never', 'always', 'constitutional',
      't0', 'tier 0', 'seal', 'mcap', 'ratif', 'consent', 'bilateral',
    ];
    highMarkers.forEach(m => {
      if (text.includes(m)) importance += 0.05;
    });

    // Session-reference density (more sessions = more validated)
    const sessionRefs = (text.match(/s\d{1,3}/gi) || []).length;
    if (sessionRefs > 3) importance += 0.1;
    if (sessionRefs > 5) importance += 0.1;

    // Graduated pattern (explicitly validated)
    if (text.includes('graduated')) importance += 0.1;

    return Math.min(1, importance);
  }

  /**
   * Get memories below demotion threshold
   */
  getDemotionCandidates(threshold = 0.35) {
    const candidates = [];
    for (const [file, entry] of Object.entries(this.cache.entries)) {
      if (entry.salience_score !== null &&
          entry.salience_score <= threshold &&
          !entry.pinned) {
        candidates.push({ file, ...entry });
      }
    }
    return candidates.sort((a, b) => a.salience_score - b.salience_score);
  }

  /**
   * Get memories above promotion threshold (from WORKING)
   */
  getPromotionCandidates(threshold = 0.75) {
    const candidates = [];
    for (const [file, entry] of Object.entries(this.cache.entries)) {
      if (entry.salience_score !== null &&
          entry.salience_score >= threshold) {
        candidates.push({ file, ...entry });
      }
    }
    return candidates.sort((a, b) => b.salience_score - a.salience_score);
  }

  /**
   * Recompute all salience scores
   */
  recomputeAll(memoryDir) {
    const files = fs.readdirSync(memoryDir)
      .filter(f => f.endsWith('.md') && f !== 'MEMORY.md');

    const results = [];
    for (const file of files) {
      const content = this._readMemoryContent(path.join(memoryDir, file));
      const score = this.computeSalience(file, content);
      results.push({ file, score });
    }

    return results.sort((a, b) => b.score - a.score);
  }

  _readMemoryContent(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) return { raw: content };

      const yaml = match[1];
      const result = { raw: content };

      yaml.split('\n').forEach(line => {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim();
          const value = line.slice(colonIdx + 1).trim();
          result[key] = value;
        }
      });

      return result;
    } catch {
      return {};
    }
  }

  /**
   * Stats summary
   */
  stats() {
    const entries = Object.values(this.cache.entries);
    const scored = entries.filter(e => e.salience_score !== null);

    return {
      total: entries.length,
      scored: scored.length,
      pinned: entries.filter(e => e.pinned).length,
      avg_salience: scored.length > 0
        ? (scored.reduce((sum, e) => sum + e.salience_score, 0) / scored.length).toFixed(3)
        : null,
      below_threshold: entries.filter(e => e.salience_score !== null && e.salience_score < 0.35).length,
      above_threshold: entries.filter(e => e.salience_score !== null && e.salience_score > 0.75).length,
    };
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const cache = new SalienceCache();

  const MEMORY_DIR = path.join(
    process.env.HOME,
    '.claude/projects/-home-jk-project-gordo-backchannel/memory'
  );

  switch (args[0]) {
    case 'compute':
      if (args[1]) {
        const score = cache.computeSalience(args[1]);
        console.log(`${args[1]}: ${score}`);
      } else {
        console.log('Usage: salience-cache.js compute <memory-file>');
      }
      break;

    case 'recompute-all':
      const results = cache.recomputeAll(MEMORY_DIR);
      console.log('Top 10 by salience:');
      results.slice(0, 10).forEach(r => {
        console.log(`  ${r.score.toFixed(3)} ${r.file}`);
      });
      console.log(`\nComputed ${results.length} memories.`);
      break;

    case 'stats':
      console.log(JSON.stringify(cache.stats(), null, 2));
      break;

    case 'demotions':
      const demotions = cache.getDemotionCandidates();
      if (demotions.length === 0) {
        console.log('No demotion candidates.');
      } else {
        console.log(`${demotions.length} demotion candidates:`);
        demotions.forEach(d => {
          console.log(`  ${d.salience_score.toFixed(3)} ${d.file}`);
        });
      }
      break;

    default:
      console.log('Usage: salience-cache.js <compute|recompute-all|stats|demotions>');
  }
}

module.exports = SalienceCache;
