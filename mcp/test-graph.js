/**
 * Knowledge Graph Integration Test
 * Tests basic graph functionality with sample session data
 */

import { TinyGraph } from './dist/graph/store.js';
import { GraphQuerier } from './dist/graph/queries.js';
import { RelationshipExtractor } from './dist/graph/extractor.js';
import * as fs from 'fs';

// Sample session data
const sampleSessions = [
  {
    id: 'session_10',
    date: '2025-01-01',
    title: 'OAuth Implementation',
    content: `# OAuth Implementation

**Date:** 2025-01-01

Implemented OAuth 2.0 authentication system with token refresh logic.

**Decisions:**
- Use OAuth 2.0 with 5-minute token expiry
- Implement automatic token refresh

**Outcomes:**
- Authentication system working
- Tests passing (42/42)

**Patterns:**
- oauth_implementation
- authentication_system
`,
  },
  {
    id: 'session_23',
    date: '2025-01-15',
    title: 'Token Expiry Handling',
    content: `# Token Expiry Handling

**Date:** 2025-01-15

Fixed token expiry edge cases discovered in production.

**Dependencies:**
- Built on Session 10's OAuth implementation

**Outcomes:**
- Edge cases fixed
- Tests updated

**Patterns:**
- oauth_debugging
`,
  },
  {
    id: 'session_31',
    date: '2025-01-20',
    title: 'Auth Refactoring',
    content: `# Auth Refactoring

**Date:** 2025-01-20

Refactored authentication to use standardized OAuth library.

**Dependencies:**
- Builds on Session 10 and Session 23

**Decisions:**
- Standardize on oauth-lib for consistency
- Expected impact: Reduce maintenance burden

**Outcomes:**
- Code simplified
- Tests passing

**Patterns:**
- refactoring
- oauth_refactoring
`,
  },
  {
    id: 'session_47',
    date: '2025-02-01',
    title: 'Fix OAuth Token Refresh Bug',
    content: `# Fix OAuth Token Refresh Bug

**Date:** 2025-02-01

Fixed race condition in token refresh logic introduced by Session 31 refactoring.

**Dependencies:**
- Session 31 (where bug was introduced)
- Session 10 (original implementation)

**Resolves:**
- Bug from Session 38 (not included in this test)

**Outcomes:**
- Bug fixed
- Race condition resolved

**Patterns:**
- oauth_debugging
- concurrency_issues
`,
  }
];

async function testGraphBasics() {
  console.log('🧪 Testing Knowledge Graph Basics...\n');

  // Initialize graph
  const graph = new TinyGraph('./.gordo-memory-test/graph.json', false); // No auto-save for test
  const querier = new GraphQuerier(graph);

  // Add session nodes
  console.log('📝 Adding session nodes...');
  for (const session of sampleSessions) {
    graph.addNode({
      id: `session_${session.id.replace('session_', '')}`,
      type: 'session',
      date: session.date,
      title: session.title,
      summary: session.content.substring(0, 100),
      outcomes: session.content.match(/- (.+)/g) || [],
      patterns: session.content.includes('oauth') ? ['oauth'] : [],
      created: new Date().toISOString()
    });
  }

  // Add chronological edges
  console.log('🔗 Adding chronological edges...');
  for (let i = 1; i < sampleSessions.length; i++) {
    graph.addEdge({
      id: `follows_${i}`,
      type: 'follows',
      source: `session_${sampleSessions[i-1].id.replace('session_', '')}`,
      target: `session_${sampleSessions[i].id.replace('session_', '')}`,
      weight: 1.0,
      created: new Date().toISOString()
    });
  }

  // Add dependency edges
  console.log('🔗 Adding dependency edges...');
  graph.addEdge({
    id: 'dep_23_10',
    type: 'depends_on',
    source: 'session_23',
    target: 'session_10',
    weight: 0.9,
    metadata: { reason: 'Built on OAuth implementation' },
    created: new Date().toISOString()
  });

  graph.addEdge({
    id: 'dep_31_10',
    type: 'depends_on',
    source: 'session_31',
    target: 'session_10',
    weight: 0.8,
    created: new Date().toISOString()
  });

  graph.addEdge({
    id: 'dep_47_31',
    type: 'depends_on',
    source: 'session_47',
    target: 'session_31',
    weight: 0.9,
    metadata: { reason: 'Bug introduced by refactoring' },
    created: new Date().toISOString()
  });

  // Test 1: Get graph statistics
  console.log('\n📊 Graph Statistics:');
  const stats = querier.getStats();
  console.log(JSON.stringify(stats, null, 2));

  // Test 2: Query subgraph around session_31
  console.log('\n🔍 Query: Subgraph around session_31 (depth=2)');
  const subgraph = querier.queryGraph('session_31', { depth: 2 });
  console.log(`Found ${subgraph.nodes.size} nodes, ${subgraph.edges.length} edges`);
  console.log('Nodes:', Array.from(subgraph.nodes.keys()));

  // Test 3: Query dependencies for session_47
  console.log('\n🔗 Query: Dependencies for session_47');
  const deps = querier.queryDependencies('session_47');
  console.log(`Direct dependencies: ${deps.directDependencies.length}`);
  console.log(`Transitive dependencies: ${deps.transitiveDependencies.length}`);
  console.log('Dependency chain:', deps.directDependencies.map(d => d.id));

  // Test 4: Find path from session_10 to session_47
  console.log('\n🛤️  Query: Path from session_10 to session_47');
  const path = querier.queryPath('session_10', 'session_47');
  if (path) {
    console.log(`Path length: ${path.length}`);
    console.log('Path:', path.nodes.join(' → '));
  } else {
    console.log('No path found');
  }

  // Test 5: Query timeline
  console.log('\n📅 Query: Session timeline');
  const timeline = querier.queryTimeline();
  console.log('Timeline:');
  timeline.forEach(s => console.log(`  ${s.date}: ${s.title}`));

  // Test 6: Serialize and deserialize
  console.log('\n💾 Testing serialization...');
  const json = graph.serialize();
  console.log(`Serialized size: ${json.length} bytes`);

  const newGraph = new TinyGraph('./.gordo-memory-test/graph2.json', false);
  newGraph.deserialize(json);
  const newStats = newGraph.getStats();
  console.log('Deserialized stats:', JSON.stringify(newStats, null, 2));

  // Cleanup
  console.log('\n🧹 Cleaning up test files...');
  if (fs.existsSync('.gordo-memory-test')) {
    fs.rmSync('.gordo-memory-test', { recursive: true });
  }

  console.log('\n✅ All tests passed!');
}

// Run tests
testGraphBasics().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
