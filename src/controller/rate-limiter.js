#!/usr/bin/env node

/**
 * Rate Limiter — Memory Protocol Phase 2
 *
 * Enforces per-session limits to prevent bulk corruption.
 * From PRD:
 * - CORE promotions: max 10 per session
 * - DECISIONS: max 2 per session (triggers human review if exceeded)
 * - ARCHIVAL updates: max 50 per session
 *
 * @author Gordo (AI participant)
 * @version 0.1.0
 * @session S233
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_PATH = path.join(__dirname, '../.rate-limiter-state.json');

class RateLimiter {
  constructor(statePath = DEFAULT_STATE_PATH) {
    this.statePath = statePath;
    this.state = this._load();
    this._checkSessionReset();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    } catch {
      return this._freshState();
    }
  }

  _freshState() {
    return {
      session: this._detectSession(),
      started_at: new Date().toISOString(),
      counts: {
        core_promotions: 0,
        decisions: 0,
        archival_updates: 0,
        demotions: 0,
        supersessions: 0,
      },
      human_review_triggered: false,
      last_operation: null,
    };
  }

  _save() {
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
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

  _checkSessionReset() {
    const currentSession = this._detectSession();
    if (this.state.session !== currentSession) {
      this.state = this._freshState();
      this._save();
    }
  }

  /**
   * Limits per PRD §4.5
   */
  static LIMITS = {
    core_promotions: 10,
    decisions: 2,
    archival_updates: 50,
    demotions: 10,
    supersessions: 5,
  };

  /**
   * Check if an operation is allowed
   * Returns { allowed: boolean, remaining: number, requires_review: boolean }
   */
  check(operationType) {
    const limit = RateLimiter.LIMITS[operationType];
    if (limit === undefined) {
      return { allowed: true, remaining: Infinity, requires_review: false };
    }

    const current = this.state.counts[operationType] || 0;
    const remaining = limit - current;

    // DECISIONS exceeding 2 triggers human review
    const requires_review = operationType === 'decisions' && current >= 2;

    return {
      allowed: remaining > 0,
      remaining,
      requires_review,
      limit,
      current,
    };
  }

  /**
   * Record an operation (returns check result + records if allowed)
   */
  record(operationType) {
    const checkResult = this.check(operationType);

    if (!checkResult.allowed) {
      return {
        ...checkResult,
        recorded: false,
        message: `Rate limit exceeded for ${operationType}. Max ${checkResult.limit} per session.`,
      };
    }

    if (checkResult.requires_review) {
      this.state.human_review_triggered = true;
      return {
        ...checkResult,
        recorded: false,
        message: `Human review required: ${operationType} count (${checkResult.current}) exceeds safe threshold.`,
      };
    }

    this.state.counts[operationType] = (this.state.counts[operationType] || 0) + 1;
    this.state.last_operation = {
      type: operationType,
      timestamp: new Date().toISOString(),
    };
    this._save();

    return {
      ...checkResult,
      remaining: checkResult.remaining - 1,
      recorded: true,
      message: `${operationType} recorded. ${checkResult.remaining - 1} remaining.`,
    };
  }

  /**
   * Get current session stats
   */
  stats() {
    return {
      session: this.state.session,
      started_at: this.state.started_at,
      counts: this.state.counts,
      limits: RateLimiter.LIMITS,
      human_review_triggered: this.state.human_review_triggered,
      remaining: Object.fromEntries(
        Object.entries(RateLimiter.LIMITS).map(([k, v]) => [
          k,
          v - (this.state.counts[k] || 0),
        ])
      ),
    };
  }

  /**
   * Human override to allow operation past limit
   */
  override(operationType, reason) {
    this.state.counts[operationType] = (this.state.counts[operationType] || 0) + 1;
    this.state.last_operation = {
      type: operationType,
      timestamp: new Date().toISOString(),
      override: true,
      reason,
    };
    this._save();

    return {
      recorded: true,
      message: `Override recorded: ${operationType} (${reason})`,
    };
  }

  /**
   * Reset for new session (usually automatic)
   */
  reset() {
    this.state = this._freshState();
    this._save();
    return { message: 'Rate limiter reset for new session.' };
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const limiter = new RateLimiter();

  switch (args[0]) {
    case 'check':
      if (args[1]) {
        console.log(JSON.stringify(limiter.check(args[1]), null, 2));
      } else {
        console.log('Usage: rate-limiter.js check <operation-type>');
        console.log('Types: core_promotions, decisions, archival_updates, demotions, supersessions');
      }
      break;

    case 'record':
      if (args[1]) {
        console.log(JSON.stringify(limiter.record(args[1]), null, 2));
      } else {
        console.log('Usage: rate-limiter.js record <operation-type>');
      }
      break;

    case 'stats':
      console.log(JSON.stringify(limiter.stats(), null, 2));
      break;

    case 'reset':
      console.log(limiter.reset().message);
      break;

    default:
      console.log('Usage: rate-limiter.js <check|record|stats|reset>');
  }
}

module.exports = RateLimiter;
