// Knowledge Graph Module - Public API
// Part of gordo-memory MCP Server v0.7.0

export * from './types.js';
export { TinyGraph } from './store.js';
export { RelationshipExtractor, ExtractorConfig } from './extractor.js';
export { GraphQuerier } from './queries.js';

// Re-export main classes for convenience
export { TinyGraph as GraphStore } from './store.js';
export { RelationshipExtractor as Extractor } from './extractor.js';
export { GraphQuerier as Querier } from './queries.js';
