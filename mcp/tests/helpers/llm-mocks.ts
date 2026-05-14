/**
 * Mock LLM Helpers
 * Provides fast mock implementations of LLM calls for unit tests
 * Integration tests should use real LLM calls for confidence
 */

export interface MockDomainExtractionOptions {
  domains?: string[];
  patternCount?: number;
}

/**
 * Mock domain extraction response
 */
export function mockDomainExtraction(options: MockDomainExtractionOptions = {}) {
  const domains = options.domains || ['authentication', 'testing', 'deployment'];
  const patternCount = options.patternCount || 3;

  const patterns = [];
  for (let i = 0; i < patternCount; i++) {
    const domain = domains[i % domains.length];
    patterns.push({
      domain,
      title: `${domain.charAt(0).toUpperCase() + domain.slice(1)} Pattern ${i + 1}`,
      description: `Mock pattern for ${domain}`,
      keywords: [domain, 'mock', 'test'],
      sessions: [`Session_${i + 1}`],
      confidence: 0.9
    });
  }

  return {
    domains,
    patterns
  };
}

/**
 * Mock relationship extraction response
 */
export function mockRelationshipExtraction() {
  return {
    dependencies: [
      {
        target: 'Session_01',
        reason: 'Builds on authentication from Session 1'
      }
    ],
    resolutions: [],
    decisions: []
  };
}

/**
 * Mock Ollama API for domain extraction
 */
export function createMockOllamaServer() {
  return {
    async fetch(url: string, options: any) {
      const body = JSON.parse(options.body);

      if (url.includes('/api/generate')) {
        // Mock domain extraction
        return {
          ok: true,
          json: async () => ({
            response: JSON.stringify(mockDomainExtraction())
          })
        };
      }

      if (url.includes('/api/embeddings')) {
        // Mock embeddings (1024 dimensions for mxbai-embed-large)
        return {
          ok: true,
          json: async () => ({
            embedding: Array(1024).fill(0).map(() => Math.random() * 2 - 1)
          })
        };
      }

      throw new Error(`Unmocked URL: ${url}`);
    }
  };
}

/**
 * Patch global fetch to use mock Ollama
 */
export function mockOllama() {
  const originalFetch = global.fetch;
  const mockServer = createMockOllamaServer();

  global.fetch = async (url: any, options?: any) => {
    if (typeof url === 'string' && url.includes('localhost:11434')) {
      return mockServer.fetch(url, options) as any;
    }
    return originalFetch(url, options);
  };

  return () => {
    global.fetch = originalFetch;
  };
}
