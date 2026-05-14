#!/usr/bin/env node

/**
 * Contradiction Detector — Memory Protocol Phase 2
 *
 * Detects potential contradictions between memories.
 * Uses keyword overlap + semantic signals to flag conflicts.
 *
 * Resolution policy (from PRD):
 * 1. Temporal ordering (default): Later supersedes earlier
 * 2. Source authority: stated > inferred > external
 * 3. Confidence: Higher confidence wins within 0.2 threshold
 * 4. Escalation: If unresolvable, FLAG_CONTRADICTION and surface to human
 *
 * @author Gordo (AI participant)
 * @version 0.1.0
 * @session S233
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MEMORY_DIR = path.join(
  process.env.HOME,
  '.claude/projects/-home-jk-project-gordo-backchannel/memory'
);

class ContradictionDetector {
  constructor(memoryDir = DEFAULT_MEMORY_DIR) {
    this.memoryDir = memoryDir;
    this.memories = new Map();
    this._loadMemories();
  }

  _loadMemories() {
    const files = fs.readdirSync(this.memoryDir)
      .filter(f => f.endsWith('.md') && f !== 'MEMORY.md');

    for (const file of files) {
      const content = fs.readFileSync(path.join(this.memoryDir, file), 'utf8');
      const parsed = this._parseMemory(content);
      this.memories.set(file, {
        file,
        ...parsed,
        keywords: this._extractKeywords(parsed.body || content),
      });
    }
  }

  _parseMemory(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return { body: content };

    const yaml = match[1];
    const body = match[2].trim();
    const meta = {};

    yaml.split('\n').forEach(line => {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        meta[key] = value;
      }
    });

    return { meta, body };
  }

  _extractKeywords(text) {
    // Normalize and extract significant words
    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .filter(w => !STOP_WORDS.has(w));

    // Get unique words with frequency
    const freq = new Map();
    words.forEach(w => freq.set(w, (freq.get(w) || 0) + 1));

    // Return top keywords by frequency
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word);
  }

  /**
   * Check if a new memory contradicts existing memories
   */
  checkForContradictions(newContent) {
    const newParsed = typeof newContent === 'string'
      ? this._parseMemory(newContent)
      : newContent;
    const newKeywords = this._extractKeywords(newParsed.body || JSON.stringify(newContent));

    const conflicts = [];

    for (const [file, existing] of this.memories) {
      const overlap = this._keywordOverlap(newKeywords, existing.keywords);

      if (overlap.score > 0.3) {
        // High keyword overlap — check for contradictory signals
        const signals = this._detectContradictionSignals(
          newParsed.body || JSON.stringify(newContent),
          existing.body || ''
        );

        if (signals.length > 0) {
          conflicts.push({
            file,
            overlap_score: overlap.score,
            shared_keywords: overlap.shared.slice(0, 10),
            signals,
            resolution: this._suggestResolution(newParsed, existing),
          });
        }
      }
    }

    return conflicts.sort((a, b) => b.overlap_score - a.overlap_score);
  }

  _keywordOverlap(keywords1, keywords2) {
    const set1 = new Set(keywords1);
    const set2 = new Set(keywords2);
    const shared = keywords1.filter(k => set2.has(k));

    const union = new Set([...keywords1, ...keywords2]).size;
    const score = union > 0 ? shared.length / union : 0;

    return { score, shared };
  }

  _detectContradictionSignals(text1, text2) {
    const signals = [];

    // Negation patterns
    const negations = [
      [/\bdon't\b/i, /\bdo\b/i],
      [/\bnever\b/i, /\balways\b/i],
      [/\bavoid\b/i, /\bprefer\b/i],
      [/\bstop\b/i, /\bstart\b/i],
      [/\bnot\b/i, /\bis\b/i],
    ];

    for (const [neg, pos] of negations) {
      if ((neg.test(text1) && pos.test(text2)) ||
          (pos.test(text1) && neg.test(text2))) {
        signals.push({
          type: 'negation',
          pattern: `${neg.source} vs ${pos.source}`,
        });
      }
    }

    // Value conflicts
    const valuePatterns = [
      /\bprefer\s+(\w+)\b/gi,
      /\bdefault\s+to\s+(\w+)\b/gi,
      /\buse\s+(\w+)\b/gi,
    ];

    for (const pattern of valuePatterns) {
      const matches1 = [...text1.matchAll(pattern)];
      const matches2 = [...text2.matchAll(pattern)];

      for (const m1 of matches1) {
        for (const m2 of matches2) {
          if (m1[1] && m2[1] && m1[1].toLowerCase() !== m2[1].toLowerCase()) {
            signals.push({
              type: 'value_conflict',
              values: [m1[1], m2[1]],
            });
          }
        }
      }
    }

    return signals;
  }

  _suggestResolution(newMemory, existingMemory) {
    // Resolution policy from PRD

    // 1. Temporal ordering
    const newSession = this._extractSession(newMemory);
    const existSession = this._extractSession(existingMemory);

    if (newSession > existSession) {
      return {
        method: 'temporal',
        recommendation: 'NEW_SUPERSEDES',
        reason: `S${newSession} > S${existSession}`,
      };
    }

    // 2. Source authority
    const sourceRank = { stated: 3, inferred: 2, external: 1 };
    const newSource = newMemory.meta?.source_type || 'inferred';
    const existSource = existingMemory.meta?.source_type || 'inferred';

    if (sourceRank[newSource] > sourceRank[existSource]) {
      return {
        method: 'source_authority',
        recommendation: 'NEW_SUPERSEDES',
        reason: `${newSource} > ${existSource}`,
      };
    }

    // 3. Escalation
    return {
      method: 'escalation',
      recommendation: 'FLAG_FOR_HUMAN',
      reason: 'Could not auto-resolve',
    };
  }

  _extractSession(memory) {
    const text = memory.body || JSON.stringify(memory);
    const match = text.match(/S(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  /**
   * Full contradiction scan across all memories
   */
  fullScan() {
    const allConflicts = [];
    const checked = new Set();

    for (const [file1, mem1] of this.memories) {
      for (const [file2, mem2] of this.memories) {
        if (file1 >= file2) continue; // Avoid duplicates

        const key = `${file1}|${file2}`;
        if (checked.has(key)) continue;
        checked.add(key);

        const overlap = this._keywordOverlap(mem1.keywords, mem2.keywords);

        if (overlap.score > 0.3) {
          const signals = this._detectContradictionSignals(
            mem1.body || '',
            mem2.body || ''
          );

          if (signals.length > 0) {
            allConflicts.push({
              file1,
              file2,
              overlap_score: overlap.score,
              shared_keywords: overlap.shared.slice(0, 5),
              signals,
            });
          }
        }
      }
    }

    return allConflicts.sort((a, b) => b.overlap_score - a.overlap_score);
  }
}

// Common stop words
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'are', 'was',
  'were', 'been', 'being', 'will', 'would', 'could', 'should', 'which', 'when',
  'where', 'what', 'than', 'then', 'them', 'they', 'their', 'there', 'these',
  'those', 'only', 'just', 'also', 'into', 'over', 'such', 'some', 'more',
  'most', 'other', 'about', 'after', 'before', 'between', 'through', 'during',
]);

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const detector = new ContradictionDetector();

  switch (args[0]) {
    case 'scan':
      const conflicts = detector.fullScan();
      if (conflicts.length === 0) {
        console.log('No contradictions detected.');
      } else {
        console.log(`Found ${conflicts.length} potential contradictions:\n`);
        conflicts.forEach((c, i) => {
          console.log(`${i + 1}. ${c.file1}`);
          console.log(`   vs ${c.file2}`);
          console.log(`   Overlap: ${(c.overlap_score * 100).toFixed(1)}%`);
          console.log(`   Keywords: ${c.shared_keywords.join(', ')}`);
          console.log(`   Signals: ${c.signals.map(s => s.type).join(', ')}`);
          console.log('');
        });
      }
      break;

    case 'check':
      if (args[1]) {
        const newContent = fs.readFileSync(args[1], 'utf8');
        const results = detector.checkForContradictions(newContent);
        if (results.length === 0) {
          console.log('No contradictions with existing memories.');
        } else {
          console.log(`Found ${results.length} potential conflicts:`);
          results.forEach(r => {
            console.log(`  - ${r.file} (${(r.overlap_score * 100).toFixed(1)}%)`);
            console.log(`    Resolution: ${r.resolution.recommendation}`);
          });
        }
      } else {
        console.log('Usage: contradiction-detector.js check <new-memory-file>');
      }
      break;

    default:
      console.log('Usage: contradiction-detector.js <scan|check>');
      console.log('  scan        - Scan all memories for contradictions');
      console.log('  check FILE  - Check if FILE contradicts existing memories');
  }
}

module.exports = ContradictionDetector;
