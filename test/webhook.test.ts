import { describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';

// Mock webhook payload
const mockPayload = {
  action: 'created',
  issue: {
    number: 1,
    pull_request: {
      url: 'https://api.github.com/repos/owner/repo/pulls/1',
      head: {
        sha: '1234567890abcdef'
      }
    }
  },
  comment: {
    body: '/articlecheck'
  },
  repository: {
    full_name: 'owner/repo'
  }
};

// Helper function to create signature
function createSignature(payload: any, secret: string): string {
  const hmac = createHmac('sha256', secret);
  const digest = hmac.update(JSON.stringify(payload)).digest('hex');
  return `sha256=${digest}`;
}

describe('Webhook Handler', () => {
  it('should accept valid webhook requests', async () => {
    const secret = 'test-secret';
    const signature = createSignature(mockPayload, secret);

    const request = new Request('http://localhost:8787', {
      method: 'POST',
      headers: {
        'x-github-event': 'issue_comment',
        'x-hub-signature-256': signature,
        'x-github-delivery': '123',
        'content-type': 'application/json'
      },
      body: JSON.stringify(mockPayload)
    });

    const env = {
      WEBHOOK_SECRET: secret,
      PR_QUEUE: {
        send: async () => {}
      }
    };

    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {}
    };

    const worker = await import('../src/index');
    const response = await worker.default.fetch(request, env as any, ctx as any);

    expect(response.status).toBe(202);
    expect(await response.text()).toBe('Article check queued');
  });

  it('should reject requests with invalid signatures', async () => {
    const request = new Request('http://localhost:8787', {
      method: 'POST',
      headers: {
        'x-github-event': 'issue_comment',
        'x-hub-signature-256': 'invalid-signature',
        'x-github-delivery': '123',
        'content-type': 'application/json'
      },
      body: JSON.stringify(mockPayload)
    });

    const env = {
      WEBHOOK_SECRET: 'test-secret',
      PR_QUEUE: {
        send: async () => {}
      }
    };

    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {}
    };

    const worker = await import('../src/index');
    const response = await worker.default.fetch(request, env as any, ctx as any);

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Invalid signature');
  });
}); 