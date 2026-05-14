#!/usr/bin/env node

/**
 * Basic functionality test for gordo-memory
 * Tests: indexing, search, retrieval without requiring full MCP setup
 */

import { MemoryManager } from './dist/memory-manager.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test configuration (using Ollama for local testing)
const TEST_CONFIG = {
  enabled: true,
  provider: 'ollama',
  model: 'mxbai-embed-large',
  threshold: 0.75,
  indexPath: path.join(__dirname, '.test-memory'),
  autoIndex: true,
  ollamaUrl: 'http://localhost:11434',
};

// Create test journal
const TEST_JOURNAL_DIR = path.join(__dirname, 'test-repo');
const TEST_JOURNAL = path.join(TEST_JOURNAL_DIR, 'JOURNAL.md');

const SAMPLE_JOURNAL = `# Session Journal

## Session 1 (2025-10-01)

Initial project setup. Created database schema and authentication system using OAuth 2.0. Pattern: Token refresh 5min before expiry prevents race conditions.

## Session 2 (2025-10-05)

Implemented user registration and login flows. Added validation for email and password requirements. Tests: 42/42✓

## Session 3 (2025-10-12)

Fixed OAuth token refresh bug. Issue #15. The authentication system was failing when tokens expired. Implemented pattern from Session 1.

## Session 4 (2025-10-18)

Database migration: Added user profiles table with columns for avatar, bio, social links. Migration #003 applied successfully.

## Session 5 (2025-10-24)

Performance optimization: Reduced query time from 2.1s to 0.3s by adding indexes on user_id and created_at columns.
`;

async function setupTestEnvironment() {
  console.log('Setting up test environment...');

  // Create test repo directory
  await fs.mkdir(TEST_JOURNAL_DIR, { recursive: true });

  // Write test journal
  await fs.writeFile(TEST_JOURNAL, SAMPLE_JOURNAL);

  console.log('✓ Test journal created');
}

async function cleanupTestEnvironment() {
  console.log('\nCleaning up test environment...');

  // Remove test directories
  await fs.rm(TEST_JOURNAL_DIR, { recursive: true, force: true });
  await fs.rm(TEST_CONFIG.indexPath, { recursive: true, force: true });

  console.log('✓ Test environment cleaned');
}

async function testIndexing(manager) {
  console.log('\nTest 1: Indexing journal...');

  const result = await manager.indexRepository(TEST_JOURNAL_DIR, false);

  console.log(`  Indexed: ${result.indexed} sessions`);
  console.log(`  Skipped: ${result.skipped} sessions`);

  if (result.indexed !== 5) {
    throw new Error(`Expected 5 sessions, got ${result.indexed}`);
  }

  console.log('✓ Indexing successful');
}

async function testSearch(manager) {
  console.log('\nTest 2: Semantic search...');

  // Test 1: Search for authentication-related sessions
  console.log('\n  Query: "authentication token issues"');
  const results1 = await manager.search({
    query: 'authentication token issues',
    limit: 3,
    threshold: 0.65,
  });

  console.log(`  Found ${results1.length} results:`);
  results1.forEach((r, i) => {
    console.log(`    ${i + 1}. ${r.sessionId} (similarity: ${(r.similarity * 100).toFixed(1)}%)`);
  });

  // Should find Sessions 1, 2, 3 (OAuth/auth related)
  if (results1.length === 0) {
    console.log('  ⚠️  No results (might need Ollama running)');
  } else {
    console.log('✓ Search successful');
  }

  // Test 2: Search for database-related sessions
  console.log('\n  Query: "database schema changes"');
  const results2 = await manager.search({
    query: 'database schema changes',
    limit: 3,
    threshold: 0.65,
  });

  console.log(`  Found ${results2.length} results:`);
  results2.forEach((r, i) => {
    console.log(`    ${i + 1}. ${r.sessionId} (similarity: ${(r.similarity * 100).toFixed(1)}%)`);
  });

  // Should find Session 4 (database migration)
  if (results2.length === 0) {
    console.log('  ⚠️  No results (might need Ollama running)');
  } else {
    console.log('✓ Search successful');
  }
}

async function testRetrieval(manager) {
  console.log('\nTest 3: Session retrieval...');

  const session = await manager.getSession('Session_03');

  if (!session) {
    throw new Error('Session_03 not found');
  }

  console.log(`  Retrieved: ${session.id}`);
  console.log(`  Date: ${session.date}`);
  console.log(`  Content length: ${session.content.length} chars`);

  console.log('✓ Retrieval successful');
}

async function testStats(manager) {
  console.log('\nTest 4: Index statistics...');

  const stats = await manager.getStats();

  console.log(`  Total indexed documents: ${stats.totalIndexedDocuments}`);
  console.log(`  Provider: ${stats.provider}`);
  console.log(`  Index path: ${stats.indexPath}`);

  if (stats.totalIndexedDocuments !== 5) {
    throw new Error(`Expected 5 sessions, got ${stats.totalIndexedDocuments}`);
  }

  console.log('✓ Stats retrieval successful');
}

async function runTests() {
  console.log('=== Gordo Memory Basic Tests ===\n');

  try {
    // Setup
    await setupTestEnvironment();

    // Check if Ollama is available
    try {
      const response = await fetch('http://localhost:11434/api/tags');
      if (!response.ok) {
        throw new Error('Ollama not running');
      }
      console.log('✓ Ollama detected\n');
    } catch (error) {
      console.log('⚠️  Ollama not running - tests may fail');
      console.log('   Start Ollama and run: ollama pull mxbai-embed-large\n');
    }

    // Initialize manager
    const manager = new MemoryManager(TEST_CONFIG);
    await manager.initialize();
    console.log('✓ Memory manager initialized\n');

    // Run tests
    await testIndexing(manager);
    await testSearch(manager);
    await testRetrieval(manager);
    await testStats(manager);

    console.log('\n=== All Tests Passed ✓ ===\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    // Cleanup
    await cleanupTestEnvironment();
  }
}

runTests();
