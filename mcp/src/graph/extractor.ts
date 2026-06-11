// Relationship Extractor - LLM-powered relationship detection
// Part of gordo-ledger MCP Server v0.7.0

import OpenAI from 'openai';
import { RelationshipExtraction, SessionNode } from './types.js';

/**
 * Extraction prompt template
 */
const EXTRACTION_PROMPT = `Analyze this session and extract relationships.

SESSION CONTENT:
---
{CONTENT}
---

Extract the following (return as valid JSON only, no explanation):

{
  "dependencies": [
    // Does this session reference/build on previous sessions?
    // Format: { "target": "session_X" or "session_42", "reason": "brief explanation" }
  ],
  "resolutions": [
    // Does this resolve a problem from a previous session?
    // Format: { "target": "session_X", "reason": "what was resolved" }
  ],
  "patterns": [
    // What recurring patterns appear? (oauth, database, deployment, testing, etc.)
    // Format: { "pattern": "pattern_name", "description": "brief description" }
  ],
  "decisions": [
    // What architectural/strategic decisions were made?
    // Format: { "decision": "title", "rationale": "why", "expectedImpact": "predicted effect" }
  ],
  "outcomes": [
    // What was achieved? (bug_fixed, feature_added, refactored, documented, etc.)
    // Format: { "outcome": "outcome_type", "description": "brief description" }
  ]
}

Return ONLY the JSON object, no markdown formatting, no explanation.`;

/**
 * Configuration for extraction
 */
export interface ExtractorConfig {
  provider: 'openai' | 'openrouter' | 'ollama';
  model?: string;  // Model to use for extraction
  apiKey?: string; // OpenAI/OpenRouter API key
  baseUrl?: string; // Custom base URL (for OpenRouter compatibility)
  ollamaUrl?: string; // Ollama base URL (if provider = 'ollama')
  temperature?: number; // LLM temperature (default: 0.1 for consistency)
}

/**
 * RelationshipExtractor - Extracts relationships from session content
 */
export class RelationshipExtractor {
  private config: ExtractorConfig;
  private openai?: OpenAI;

  constructor(config: ExtractorConfig) {
    this.config = {
      temperature: 0.1, // Low temperature for consistent extraction
      ...config
    };

    if (this.config.provider === 'openai' || this.config.provider === 'openrouter') {
      if (!this.config.apiKey) {
        throw new Error(`API key required when provider is "${this.config.provider}"`);
      }
      const openaiConfig: { apiKey: string; baseURL?: string } = { apiKey: this.config.apiKey };
      if (this.config.provider === 'openrouter') {
        openaiConfig.baseURL = this.config.baseUrl || 'https://openrouter.ai/api/v1';
      }
      this.openai = new OpenAI(openaiConfig);
    }
  }

  /**
   * Extract relationships from session content
   * @param content Session markdown content
   * @param sessionId Session ID (for context)
   * @returns Extracted relationships
   */
  async extract(content: string, sessionId: string): Promise<RelationshipExtraction> {
    try {
      const prompt = EXTRACTION_PROMPT.replace('{CONTENT}', content);

      let responseText: string;

      if (this.config.provider === 'openai' || this.config.provider === 'openrouter') {
        responseText = await this.extractWithOpenAI(prompt);
      } else {
        responseText = await this.extractWithOllama(prompt);
      }

      // Parse JSON response
      const extraction = this.parseExtraction(responseText);
      return extraction;
    } catch (error) {
      console.error(`Failed to extract relationships for ${sessionId}:`, error);
      // Return empty extraction on error (graceful degradation)
      return {
        dependencies: [],
        resolutions: [],
        patterns: [],
        decisions: [],
        outcomes: []
      };
    }
  }

  /**
   * Extract using OpenAI
   */
  private async extractWithOpenAI(prompt: string): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const model = this.config.model || 'gpt-4o-mini'; // Use gpt-4o-mini for cost efficiency
    const response = await this.openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a relationship extraction assistant. Extract structured relationships from session content and return valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: this.config.temperature,
      response_format: { type: 'json_object' } // Force JSON response
    });

    return response.choices[0]?.message?.content || '{}';
  }

  /**
   * Extract using Ollama
   */
  private async extractWithOllama(prompt: string): Promise<string> {
    const baseUrl = this.config.ollamaUrl || 'http://localhost:11434';

    // Knowledge graph needs a CHAT model, not an embedding model
    // If config.model is an embedding model (contains 'embed'), use fallback chat model
    const isEmbeddingModel = this.config.model?.toLowerCase().includes('embed');
    const model = (isEmbeddingModel || !this.config.model) ? 'llama3.2' : this.config.model;

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: 'json', // Request JSON format
        options: {
          temperature: this.config.temperature
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.statusText}`);
    }

    const data = await response.json() as { response?: string };
    return data.response || '{}';
  }

  /**
   * Parse extraction response (handle various JSON formats)
   */
  private parseExtraction(responseText: string): RelationshipExtraction {
    try {
      // Remove markdown code blocks if present
      let cleaned = responseText.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/```\n?/g, '');
      }

      const parsed = JSON.parse(cleaned);

      // Validate structure
      return {
        dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies : [],
        resolutions: Array.isArray(parsed.resolutions) ? parsed.resolutions : [],
        patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
        outcomes: Array.isArray(parsed.outcomes) ? parsed.outcomes : []
      };
    } catch (error) {
      console.error('Failed to parse extraction response:', error);
      console.error('Response text:', responseText);
      return {
        dependencies: [],
        resolutions: [],
        patterns: [],
        decisions: [],
        outcomes: []
      };
    }
  }

  /**
   * Extract session metadata from content
   * @param content Session markdown content
   * @param sessionId Session ID
   * @returns Session node data
   */
  extractSessionMetadata(content: string, sessionId: string): Partial<SessionNode> {
    // Extract title (first # heading)
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : `Session ${sessionId}`;

    // Extract date (look for date patterns)
    const dateMatch = content.match(/\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})/i) ||
                     content.match(/\[(\d{4}-\d{2}-\d{2})\]/) ||
                     content.match(/(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];

    // Extract summary (first paragraph after title, up to 200 chars)
    // Skip metadata lines like "**Date:**", "**Context:**", etc.
    const lines = content.split('\n');
    let summary = '';
    let inContent = false;
    let blankLinesSeen = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip title line
      if (trimmed.startsWith('#')) {
        inContent = true;
        continue;
      }

      if (!inContent) continue;

      // Track blank lines
      if (trimmed === '') {
        blankLinesSeen++;
        continue;
      }

      // Skip metadata lines (bold key-value pairs)
      if (trimmed.match(/^\*\*\w+:\*\*/)) {
        blankLinesSeen = 0; // Reset, metadata doesn't count as paragraph start
        continue;
      }

      // Skip section headings
      if (trimmed.startsWith('##')) {
        break; // Stop at first section heading
      }

      // Found first real content paragraph
      if (blankLinesSeen > 0) {
        summary = trimmed;
        break;
      }
    }

    if (summary.length > 200) {
      summary = summary.substring(0, 197) + '...';
    }
    if (!summary) {
      summary = `Session ${sessionId}`;
    }

    return {
      id: `session_${sessionId}`,
      type: 'session',
      date,
      title,
      summary,
      outcomes: [],
      patterns: [],
      created: new Date().toISOString()
    };
  }
}
