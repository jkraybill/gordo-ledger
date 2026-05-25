/**
 * Code Semantic Extractor - LLM-based code understanding
 * Part of gordo-ledger issue #9: Index code with semantic summaries
 *
 * Uses local LLM (Ollama) to extract semantic facts from code files:
 * - Function/class purposes
 * - Constants and configuration values
 * - API endpoints and their behaviors
 * - Data model structures
 * - Architectural patterns
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export interface CodeExtraction {
  filePath: string;
  relativePath: string;
  language: string;
  contentHash: string;
  extractedAt: string;
  summary: string;           // One-paragraph overview
  functions: FunctionFact[];
  classes: ClassFact[];
  constants: ConstantFact[];
  apis: ApiFact[];
  patterns: string[];        // Architectural patterns observed
}

export interface FunctionFact {
  name: string;
  purpose: string;
  params?: string;
  returns?: string;
}

export interface ClassFact {
  name: string;
  purpose: string;
  fields?: string[];
  methods?: string[];
}

export interface ConstantFact {
  name: string;
  value: string;
  meaning: string;
}

export interface ApiFact {
  endpoint: string;
  method: string;
  purpose: string;
}

export interface CodeExtractorConfig {
  ollamaUrl: string;
  model: string;           // e.g., 'qwen2.5:3b' for fast local extraction
  cachePath: string;       // Where to store extraction results
  maxFileSize: number;     // Skip files larger than this (bytes)
  maxChunkSize: number;    // Chunk large files for extraction
}

const DEFAULT_CONFIG: Partial<CodeExtractorConfig> = {
  ollamaUrl: 'http://localhost:11434',
  model: 'qwen2.5:3b',
  maxFileSize: 100_000,    // 100KB
  maxChunkSize: 8000,      // ~8K chars per chunk
};

// Language detection by extension
const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript/React',
  '.js': 'JavaScript', '.jsx': 'JavaScript/React',
  '.py': 'Python',
  '.java': 'Java',
  '.go': 'Go',
  '.rs': 'Rust',
  '.c': 'C', '.cpp': 'C++', '.h': 'C/C++ Header', '.hpp': 'C++ Header',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.sh': 'Shell', '.bash': 'Bash',
  '.sql': 'SQL',
  '.yaml': 'YAML', '.yml': 'YAML',
  '.json': 'JSON',
};

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_MAP[ext] || 'Unknown';
}

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Build extraction prompt for LLM
 */
function buildExtractionPrompt(code: string, language: string, filePath: string): string {
  return `Analyze this ${language} code and extract semantic facts. Be concise and precise.

FILE: ${filePath}

CODE:
\`\`\`${language.toLowerCase()}
${code}
\`\`\`

Extract the following (skip sections with no relevant content):

## Summary
One paragraph describing what this file does and its role in the system.

## Functions
For each significant function/method:
- NAME: purpose (params -> return type if relevant)

## Classes/Types
For each class, interface, or type:
- NAME: purpose
  - key fields: field1, field2 (IMPORTANT: include actual variable names like moviesById, userMap, etc.)
  - key methods: method1, method2

## Constants/Config
For each important constant or config value:
- NAME = VALUE: what it means/controls

## API Endpoints
For each HTTP endpoint or API route:
- METHOD /path: purpose

## Patterns
List any architectural patterns observed (e.g., "Repository pattern", "Dependency injection", "Event-driven").

Respond ONLY with the structured sections above. Be brief — one line per item.`;
}

/**
 * Parse LLM response into structured extraction
 */
function parseExtractionResponse(
  response: string,
  filePath: string,
  relativePath: string,
  language: string,
  contentHash: string
): CodeExtraction {
  const extraction: CodeExtraction = {
    filePath,
    relativePath,
    language,
    contentHash,
    extractedAt: new Date().toISOString(),
    summary: '',
    functions: [],
    classes: [],
    constants: [],
    apis: [],
    patterns: [],
  };

  // Parse sections
  const sections = response.split(/^## /m);

  for (const section of sections) {
    const lines = section.trim().split('\n');
    const header = lines[0]?.toLowerCase() || '';
    const content = lines.slice(1).join('\n').trim();

    if (header.startsWith('summary')) {
      extraction.summary = content;
    } else if (header.startsWith('function')) {
      // Parse function facts: "- NAME: purpose (params -> return)"
      const funcLines = content.split('\n').filter(l => l.startsWith('-'));
      for (const line of funcLines) {
        const match = line.match(/^-\s*(\w+):\s*(.+)$/);
        if (match) {
          extraction.functions.push({
            name: match[1],
            purpose: match[2],
          });
        }
      }
    } else if (header.startsWith('class') || header.startsWith('type')) {
      // Parse class facts with optional indented fields/methods (S344)
      const lines = content.split('\n');
      let currentClass: ClassFact | null = null;

      for (const line of lines) {
        // Main class line: "- NAME: purpose"
        const classMatch = line.match(/^-\s*(\w+):\s*(.+)$/);
        if (classMatch) {
          if (currentClass) {
            extraction.classes.push(currentClass);
          }
          currentClass = {
            name: classMatch[1],
            purpose: classMatch[2],
            fields: [],
            methods: [],
          };
        } else if (currentClass && line.trim().startsWith('-')) {
          // Indented line: "  - key fields: field1, field2" or "  - key methods: ..."
          const fieldsMatch = line.match(/key\s*fields?:\s*(.+)/i);
          const methodsMatch = line.match(/key\s*methods?:\s*(.+)/i);

          if (fieldsMatch) {
            // Parse comma-separated field names
            const fieldNames = fieldsMatch[1].split(',').map(f => f.trim()).filter(f => f);
            currentClass.fields = currentClass.fields || [];
            currentClass.fields.push(...fieldNames);
          } else if (methodsMatch) {
            // Parse comma-separated method names
            const methodNames = methodsMatch[1].split(',').map(m => m.trim()).filter(m => m);
            currentClass.methods = currentClass.methods || [];
            currentClass.methods.push(...methodNames);
          }
        }
      }
      // Don't forget the last class
      if (currentClass) {
        extraction.classes.push(currentClass);
      }
    } else if (header.startsWith('constant') || header.startsWith('config')) {
      // Parse constant facts: "- NAME = VALUE: meaning"
      const constLines = content.split('\n').filter(l => l.startsWith('-'));
      for (const line of constLines) {
        const match = line.match(/^-\s*(\w+)\s*=\s*(.+?):\s*(.+)$/);
        if (match) {
          extraction.constants.push({
            name: match[1],
            value: match[2],
            meaning: match[3],
          });
        }
      }
    } else if (header.startsWith('api') || header.startsWith('endpoint')) {
      // Parse API facts: "- METHOD /path: purpose"
      const apiLines = content.split('\n').filter(l => l.startsWith('-'));
      for (const line of apiLines) {
        const match = line.match(/^-\s*(GET|POST|PUT|DELETE|PATCH)\s+(\S+):\s*(.+)$/i);
        if (match) {
          extraction.apis.push({
            method: match[1].toUpperCase(),
            endpoint: match[2],
            purpose: match[3],
          });
        }
      }
    } else if (header.startsWith('pattern')) {
      // Parse patterns list
      const patternLines = content.split('\n').filter(l => l.trim());
      for (const line of patternLines) {
        const pattern = line.replace(/^[-*]\s*/, '').trim();
        if (pattern) {
          extraction.patterns.push(pattern);
        }
      }
    }
  }

  return extraction;
}

/**
 * Call Ollama to extract semantic facts from code
 */
async function callOllama(
  prompt: string,
  config: CodeExtractorConfig
): Promise<string> {
  const response = await fetch(`${config.ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      prompt,
      stream: false,
      options: {
        temperature: 0.1,  // Low temp for factual extraction
        num_predict: 2000, // Limit output length
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.statusText}`);
  }

  const data = await response.json() as { response: string };
  return data.response;
}

/**
 * Extract semantic facts from a single code file
 */
export async function extractCodeFacts(
  filePath: string,
  rootPath: string,
  config: Partial<CodeExtractorConfig> = {}
): Promise<CodeExtraction | null> {
  const fullConfig: CodeExtractorConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  } as CodeExtractorConfig;

  const relativePath = path.relative(rootPath, filePath);
  const language = detectLanguage(filePath);

  // Read file content
  let content: string;
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > fullConfig.maxFileSize) {
      // Skip very large files
      return null;
    }
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }

  // Skip empty or nearly empty files
  if (content.trim().length < 50) {
    return null;
  }

  const contentHash = computeHash(content);

  // Check cache
  const cachePath = path.join(fullConfig.cachePath, `${contentHash}.json`);
  try {
    const cached = await fs.readFile(cachePath, 'utf-8');
    const extraction = JSON.parse(cached) as CodeExtraction;
    // Verify it's for the same file
    if (extraction.relativePath === relativePath) {
      return extraction;
    }
  } catch {
    // Cache miss, continue with extraction
  }

  // Truncate content if needed (keep first chunk)
  const codeToAnalyze = content.length > fullConfig.maxChunkSize
    ? content.substring(0, fullConfig.maxChunkSize) + '\n// ... (truncated)'
    : content;

  // Build prompt and call LLM
  const prompt = buildExtractionPrompt(codeToAnalyze, language, relativePath);

  try {
    const response = await callOllama(prompt, fullConfig);
    const extraction = parseExtractionResponse(
      response,
      filePath,
      relativePath,
      language,
      contentHash
    );

    // Cache the result
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(extraction, null, 2));

    return extraction;
  } catch (error) {
    console.error(`Failed to extract from ${relativePath}:`, error);
    return null;
  }
}

/**
 * Convert extraction to indexable text
 * This is what gets embedded and searched
 */
export function extractionToIndexableText(extraction: CodeExtraction): string {
  const parts: string[] = [];

  parts.push(`File: ${extraction.relativePath}`);
  parts.push(`Language: ${extraction.language}`);
  parts.push('');

  if (extraction.summary) {
    parts.push(extraction.summary);
    parts.push('');
  }

  if (extraction.functions.length > 0) {
    parts.push('Functions:');
    for (const func of extraction.functions) {
      parts.push(`- ${func.name}: ${func.purpose}`);
    }
    parts.push('');
  }

  if (extraction.classes.length > 0) {
    parts.push('Classes/Types:');
    for (const cls of extraction.classes) {
      parts.push(`- ${cls.name}: ${cls.purpose}`);
      // S344: Include fields and methods in indexable text for better BM25 matching
      if (cls.fields && cls.fields.length > 0) {
        parts.push(`  Fields: ${cls.fields.join(', ')}`);
      }
      if (cls.methods && cls.methods.length > 0) {
        parts.push(`  Methods: ${cls.methods.join(', ')}`);
      }
    }
    parts.push('');
  }

  if (extraction.constants.length > 0) {
    parts.push('Constants/Config:');
    for (const cnst of extraction.constants) {
      parts.push(`- ${cnst.name} = ${cnst.value}: ${cnst.meaning}`);
    }
    parts.push('');
  }

  if (extraction.apis.length > 0) {
    parts.push('API Endpoints:');
    for (const api of extraction.apis) {
      parts.push(`- ${api.method} ${api.endpoint}: ${api.purpose}`);
    }
    parts.push('');
  }

  if (extraction.patterns.length > 0) {
    parts.push('Patterns: ' + extraction.patterns.join(', '));
  }

  return parts.join('\n').trim();
}

/**
 * Check if extraction is available (Ollama running with model)
 */
export async function isExtractionAvailable(
  config: Partial<CodeExtractorConfig> = {}
): Promise<boolean> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config } as CodeExtractorConfig;

  try {
    const response = await fetch(`${fullConfig.ollamaUrl}/api/tags`);
    if (!response.ok) return false;

    const data = await response.json() as { models: Array<{ name: string }> };
    const modelBase = fullConfig.model.split(':')[0];
    return data.models.some(m => m.name.startsWith(modelBase));
  } catch {
    return false;
  }
}
