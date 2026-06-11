// Knowledge Graph Module - Public API
// Part of gordo-ledger MCP Server v1.0.0-rc11

export * from './types.js';
export { TinyGraph } from './store.js';
export { RelationshipExtractor, ExtractorConfig } from './extractor.js';
export { GraphQuerier } from './queries.js';
export {
  classifyNode,
  classifyArtifactType,
  classifyNodes,
  getClassificationStats,
  ClassificationResult
} from './classifier.js';

// Re-export main classes for convenience
export { TinyGraph as GraphStore } from './store.js';
export { RelationshipExtractor as Extractor } from './extractor.js';
export { GraphQuerier as Querier } from './queries.js';
