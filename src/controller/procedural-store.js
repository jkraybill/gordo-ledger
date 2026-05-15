#!/usr/bin/env node

/**
 * Procedural Store — Memory Protocol Phase 4
 *
 * Represents skills, workflows, and learned procedures.
 * Unlike declarative memory (facts), procedural memory captures HOW to do things.
 *
 * Types:
 * - skill: Claude Code skills (from .claude/skills/)
 * - workflow: Multi-step processes (like Seal ratification)
 * - pattern: Repeated behavioral patterns (like compact-single-arc rhythm)
 * - heuristic: Decision rules (like "prefer X over Y when Z")
 *
 * @author Gordo (AI participant)
 * @version 0.1.0
 * @session S234
 */

const fs = require('fs');
const path = require('path');

const PROCEDURAL_FILE = path.join(__dirname, '../.procedural-store.json');
const SKILLS_DIR = path.join(__dirname, '../../.claude/skills');
const MEMORY_DIR = path.join(
  process.env.HOME,
  '.claude/projects/-home-jk-project-gordo-backchannel/memory'
);

class ProceduralStore {
  constructor(options = {}) {
    this.proceduralFile = options.proceduralFile || PROCEDURAL_FILE;
    this.skillsDir = options.skillsDir || SKILLS_DIR;
    this.memoryDir = options.memoryDir || MEMORY_DIR;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.proceduralFile)) {
        this.store = JSON.parse(fs.readFileSync(this.proceduralFile, 'utf8'));
      } else {
        this.store = {
          procedures: {},
          meta: { created_at: new Date().toISOString() },
        };
      }
    } catch {
      this.store = {
        procedures: {},
        meta: { created_at: new Date().toISOString() },
      };
    }
  }

  _save() {
    this.store.meta.updated_at = new Date().toISOString();
    fs.writeFileSync(this.proceduralFile, JSON.stringify(this.store, null, 2));
  }

  /**
   * Index skills from .claude/skills/ directory
   */
  indexSkills() {
    const skills = [];

    if (!fs.existsSync(this.skillsDir)) {
      return skills;
    }

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(this.skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;

      const content = fs.readFileSync(skillPath, 'utf8');
      const skill = this._parseSkill(content, entry.name);

      if (skill) {
        skills.push(skill);
        this._addProcedure(skill);
      }
    }

    this._save();
    return skills;
  }

  _parseSkill(content, name) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;

    const frontmatter = frontmatterMatch[1];
    const body = content.slice(frontmatterMatch[0].length).trim();

    // Parse YAML frontmatter
    const meta = {};
    frontmatter.split('\n').forEach(line => {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        meta[key] = value;
      }
    });

    // Extract steps from workflow section
    const stepsMatch = body.match(/## Workflow\n([\s\S]*?)(?=\n## |$)/);
    const steps = [];
    if (stepsMatch) {
      const stepMatches = stepsMatch[1].matchAll(/### (?:Phase|Step) (\d+)[:\s]*([^\n]*)/g);
      for (const match of stepMatches) {
        steps.push({
          number: parseInt(match[1]),
          name: match[2].trim(),
        });
      }
    }

    return {
      id: `skill-${name}`,
      type: 'skill',
      name: meta.name || name,
      description: meta.description || '',
      version: meta.version,
      steps,
      source: `skills/${name}/SKILL.md`,
      indexed_at: new Date().toISOString(),
    };
  }

  /**
   * Index rhythm patterns from feedback memories
   */
  indexPatterns() {
    const patterns = [];

    if (!fs.existsSync(this.memoryDir)) {
      return patterns;
    }

    const files = fs.readdirSync(this.memoryDir)
      .filter(f => f.includes('rhythm') || f.includes('pattern'));

    for (const file of files) {
      const content = fs.readFileSync(path.join(this.memoryDir, file), 'utf8');
      const pattern = this._parsePattern(content, file);

      if (pattern) {
        patterns.push(pattern);
        this._addProcedure(pattern);
      }
    }

    this._save();
    return patterns;
  }

  _parsePattern(content, filename) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;

    const frontmatter = frontmatterMatch[1];
    const body = content.slice(frontmatterMatch[0].length).trim();

    // Parse YAML frontmatter
    const meta = {};
    frontmatter.split('\n').forEach(line => {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        meta[key] = value;
      }
    });

    return {
      id: `pattern-${filename.replace('.md', '')}`,
      type: 'pattern',
      name: meta.name || filename.replace('.md', ''),
      description: meta.description || body.split('\n')[0],
      source: filename,
      indexed_at: new Date().toISOString(),
    };
  }

  _addProcedure(procedure) {
    this.store.procedures[procedure.id] = procedure;
  }

  /**
   * Add a heuristic (decision rule)
   */
  addHeuristic(name, rule, options = {}) {
    const { conditions = [], exceptions = [], source } = options;

    const heuristic = {
      id: `heuristic-${Date.now()}`,
      type: 'heuristic',
      name,
      rule,
      conditions,
      exceptions,
      source,
      created_at: new Date().toISOString(),
    };

    this._addProcedure(heuristic);
    this._save();
    return heuristic;
  }

  /**
   * Add a workflow (multi-step process)
   */
  addWorkflow(name, steps, options = {}) {
    const { description, triggers = [], source } = options;

    const workflow = {
      id: `workflow-${Date.now()}`,
      type: 'workflow',
      name,
      description,
      steps: steps.map((s, i) => ({
        number: i + 1,
        name: typeof s === 'string' ? s : s.name,
        details: typeof s === 'string' ? null : s.details,
      })),
      triggers,
      source,
      created_at: new Date().toISOString(),
    };

    this._addProcedure(workflow);
    this._save();
    return workflow;
  }

  /**
   * Get procedure by ID
   */
  get(id) {
    return this.store.procedures[id];
  }

  /**
   * Search procedures by name or description
   */
  search(query) {
    const queryLower = query.toLowerCase();
    return Object.values(this.store.procedures).filter(p =>
      p.name?.toLowerCase().includes(queryLower) ||
      p.description?.toLowerCase().includes(queryLower) ||
      p.rule?.toLowerCase().includes(queryLower)
    );
  }

  /**
   * List all procedures by type
   */
  list(options = {}) {
    const { type = null } = options;
    return Object.values(this.store.procedures)
      .filter(p => !type || p.type === type)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  /**
   * Get statistics
   */
  stats() {
    const byType = {};
    for (const p of Object.values(this.store.procedures)) {
      byType[p.type] = (byType[p.type] || 0) + 1;
    }

    return {
      total: Object.keys(this.store.procedures).length,
      by_type: byType,
      created_at: this.store.meta.created_at,
      updated_at: this.store.meta.updated_at,
    };
  }

  /**
   * Full reindex: skills + patterns
   */
  reindex() {
    const skills = this.indexSkills();
    const patterns = this.indexPatterns();

    return {
      skills: skills.length,
      patterns: patterns.length,
    };
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const store = new ProceduralStore();

  switch (args[0]) {
    case 'reindex':
      const result = store.reindex();
      console.log(`\nReindexed:`);
      console.log(`  Skills: ${result.skills}`);
      console.log(`  Patterns: ${result.patterns}`);
      break;

    case 'list':
      const type = args[1];
      const items = store.list({ type });
      console.log(`\nProcedural Memory${type ? ` (${type})` : ''}:\n`);
      for (const item of items) {
        console.log(`[${item.type}] ${item.name}`);
        if (item.description) {
          console.log(`  ${item.description.substring(0, 60)}`);
        }
      }
      console.log(`\nTotal: ${items.length}`);
      break;

    case 'search':
      if (args[1]) {
        const results = store.search(args.slice(1).join(' '));
        console.log(`\nSearch results:\n`);
        results.forEach(r => {
          console.log(`[${r.type}] ${r.name}`);
        });
      }
      break;

    case 'add-heuristic':
      if (args[1] && args[2]) {
        const h = store.addHeuristic(args[1], args.slice(2).join(' '));
        console.log(`Added heuristic: ${h.id}`);
      } else {
        console.log('Usage: procedural-store.js add-heuristic <name> <rule>');
      }
      break;

    case 'stats':
      const stats = store.stats();
      console.log('\nProcedural Memory Stats\n');
      console.log(`Total: ${stats.total}`);
      if (Object.keys(stats.by_type).length > 0) {
        console.log('\nBy type:');
        for (const [type, count] of Object.entries(stats.by_type)) {
          console.log(`  ${type}: ${count}`);
        }
      }
      break;

    default:
      console.log(`
Procedural Store — Memory Protocol Phase 4

Commands:
  reindex                   Index skills and patterns
  list [type]               List procedures (skill|workflow|pattern|heuristic)
  search <query>            Search procedures
  add-heuristic <n> <rule>  Add a decision heuristic
  stats                     Store statistics

Examples:
  procedural-store.js reindex
  procedural-store.js list skill
  procedural-store.js search "session"
  procedural-store.js add-heuristic "prefer-edit" "Use Edit over Write when modifying"
`);
  }
}

module.exports = ProceduralStore;
