#!/usr/bin/env node

/**
 * Session-End Consolidation — Memory Protocol Phase 1
 *
 * Runs at session close (EOS) to:
 * 1. Review session for memory-worthy events
 * 2. Identify consolidation triggers
 * 3. Promote WORKING → CORE where thresholds met
 * 4. Log all operations to audit trail
 *
 * @author Gordo (AI participant)
 * @version 0.1.0
 * @session S233
 */

const fs = require('fs');
const path = require('path');
const MemoryController = require('./memory-controller');
const GraphStore = require('./graph-store');

// Consolidation trigger patterns
const TRIGGERS = {
  decision: [
    /we agreed/i,
    /going forward/i,
    /from now on/i,
    /the decision is/i,
    /decided:/i,
    /bilateral consensus/i,
    /WWGD\+/i,
  ],
  correction: [
    /that's wrong/i,
    /that's not right/i,
    /actually,/i,
    /correction:/i,
    /don't do that/i,
    /stop doing/i,
  ],
  pin: [
    /remember this/i,
    /note that/i,
    /important:/i,
    /save this/i,
    /always/i,
    /never/i,
  ],
  preference: [
    /I prefer/i,
    /I like/i,
    /I don't like/i,
    /I want/i,
    /I need/i,
  ],
};

class SessionConsolidator {
  constructor(options = {}) {
    this.controller = new MemoryController(options);
    this.graph = new GraphStore();
    this.session = options.session || this._detectSession();
    this.sessionLogPath = options.sessionLogPath ||
      path.join(__dirname, '../../SESSION_LOG.md');
  }

  _detectSession() {
    try {
      const content = fs.readFileSync(this.sessionLogPath, 'utf8');
      const match = content.match(/^## Session (\d+)/m);
      return match ? parseInt(match[1]) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Extract potential memories from session text
   */
  analyzeText(text) {
    const findings = {
      decisions: [],
      corrections: [],
      pins: [],
      preferences: [],
    };

    const lines = text.split('\n');

    lines.forEach((line, idx) => {
      // Check each trigger category
      for (const [category, patterns] of Object.entries(TRIGGERS)) {
        for (const pattern of patterns) {
          if (pattern.test(line)) {
            const context = lines.slice(Math.max(0, idx - 1), idx + 2).join(' ');
            findings[category + 's'].push({
              line: idx + 1,
              text: line.trim(),
              context: context.trim(),
              trigger: pattern.toString(),
            });
            break; // One match per line per category
          }
        }
      }
    });

    return findings;
  }

  /**
   * Score a finding for promotion
   */
  scoreForPromotion(finding, category) {
    let score = 0.5; // Base

    // Category weights
    const categoryWeights = {
      decisions: 0.25,
      corrections: 0.30, // Corrections are high value
      pins: 0.20,
      preferences: 0.15,
    };

    score += categoryWeights[category] || 0;

    // Length bonus (more detail = more confidence)
    if (finding.text.length > 50) score += 0.05;
    if (finding.text.length > 100) score += 0.05;

    // Explicit markers
    if (/\bz\d\b/i.test(finding.text)) score += 0.10; // z-point reference
    if (/\bT[012]\b/.test(finding.text)) score += 0.10; // Tier reference
    if (/\bMCAP\b/.test(finding.text)) score += 0.10; // Protocol reference
    if (/\bS\d{1,3}\b/.test(finding.text)) score += 0.05; // Session reference

    return Math.min(1.0, score);
  }

  /**
   * Run consolidation for current session
   */
  async consolidate(sessionSummary) {
    const report = {
      session: `S${this.session}`,
      timestamp: new Date().toISOString(),
      analyzed: 0,
      promoted: 0,
      skipped: 0,
      findings: [],
      graph: { entities: 0, relationships: 0 },
    };

    if (!sessionSummary) {
      console.log('No session summary provided, skipping analysis');
      return report;
    }

    // Phase 4: Extract entities and relationships for graph
    const graphResult = this.graph.processText(sessionSummary, {
      source: `session-${this.session}`,
      session: `S${this.session}`,
    });
    report.graph.entities = graphResult.entities.length;
    report.graph.relationships = graphResult.relationships.length;

    // Analyze session text
    const findings = this.analyzeText(sessionSummary);
    report.analyzed = Object.values(findings).flat().length;

    // Process findings by category
    for (const [category, items] of Object.entries(findings)) {
      for (const item of items) {
        const score = this.scoreForPromotion(item, category);

        if (score >= 0.75) {
          // Above threshold — would promote
          // Phase 1: Log the candidate, don't auto-promote yet
          report.findings.push({
            category,
            score: score.toFixed(2),
            text: item.text.substring(0, 100),
            action: 'CANDIDATE',
          });
          report.promoted++; // Counting candidates
        } else {
          report.findings.push({
            category,
            score: score.toFixed(2),
            text: item.text.substring(0, 100),
            action: 'BELOW_THRESHOLD',
          });
          report.skipped++;
        }
      }
    }

    // Log consolidation run to audit
    this.controller._appendAuditLog({
      operation: 'CONSOLIDATE',
      memory_id: `session-${this.session}`,
      reason: `Session ${this.session} end consolidation`,
      diff: {
        analyzed: report.analyzed,
        candidates: report.promoted,
        skipped: report.skipped,
      },
    });

    return report;
  }

  /**
   * Generate consolidation report for EOS display
   */
  formatReport(report) {
    if (report.analyzed === 0 && (!report.graph || report.graph.entities === 0)) {
      return 'Consolidation: No analyzable content';
    }

    let output = `\n**Memory Consolidation (S${this.session}):**\n`;
    output += `- Triggers analyzed: ${report.analyzed}\n`;
    output += `- Promotion candidates: ${report.promoted}\n`;
    output += `- Below threshold: ${report.skipped}\n`;

    // Graph extraction stats (Phase 4)
    if (report.graph && report.graph.entities > 0) {
      output += `- Graph: ${report.graph.entities} entities, ${report.graph.relationships} relationships\n`;
    }

    if (report.findings.length > 0 && report.findings.some(f => f.action === 'CANDIDATE')) {
      output += '\nCandidates for CORE promotion:\n';
      report.findings
        .filter(f => f.action === 'CANDIDATE')
        .slice(0, 5) // Top 5
        .forEach(f => {
          output += `  - [${f.category}] (${f.score}) "${f.text}..."\n`;
        });
    }

    return output;
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === '--help' || args.length === 0) {
    console.log('Usage: consolidation.js <session-summary-text>');
    console.log('       consolidation.js --file <path-to-summary>');
    console.log('       consolidation.js --session <N>');
    process.exit(0);
  }

  const consolidator = new SessionConsolidator();

  if (args[0] === '--file' && args[1]) {
    const content = fs.readFileSync(args[1], 'utf8');
    consolidator.consolidate(content).then(report => {
      console.log(consolidator.formatReport(report));
    });
  } else if (args[0] === '--session' && args[1]) {
    // Extract session N summary from SESSION_LOG.md
    const sessionNum = parseInt(args[1]);
    const logContent = fs.readFileSync(consolidator.sessionLogPath, 'utf8');
    const sessionMatch = logContent.match(
      new RegExp(`## Session ${sessionNum}[\\s\\S]*?(?=## Session|$)`)
    );
    if (sessionMatch) {
      consolidator.consolidate(sessionMatch[0]).then(report => {
        console.log(consolidator.formatReport(report));
      });
    } else {
      console.log(`Session ${sessionNum} not found in SESSION_LOG.md`);
    }
  } else {
    // Direct text input
    consolidator.consolidate(args.join(' ')).then(report => {
      console.log(consolidator.formatReport(report));
    });
  }
}

module.exports = SessionConsolidator;
