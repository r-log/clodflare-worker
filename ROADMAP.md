# Roadmap: GitHub Actions Bot Migration to Cloudflare Workers

## Overview

This document outlines the comprehensive plan for migrating the DNI Institute's GitHub Actions QA bot to a Cloudflare Workers-based solution. The migration aims to improve performance, unify the tech stack, and create a more scalable architecture.

## Table of Contents

- [Phase 1: Analysis & Architecture Design](#phase-1-analysis--architecture-design)
- [Phase 2: Infrastructure Setup](#phase-2-infrastructure-setup)
- [Phase 3: Core Implementation](#phase-3-core-implementation)
- [Phase 4: Quality Check Implementation](#phase-4-quality-check-implementation)
- [Phase 5: Scalability & Production Readiness](#phase-5-scalability--production-readiness)
- [Phase 6: Testing & Deployment](#phase-6-testing--deployment)
- [Production Considerations](#production-considerations)

## Phase 1: Analysis & Architecture Design

### 1.1 Current System Analysis

- **Existing Bot Analysis**

  - Document current GitHub Actions workflow
  - Map out all quality check rules
  - Identify integration points with Claude AI
  - Analyze current performance metrics and bottlenecks

- **Requirements Gathering**
  - Document webhook event triggers
  - List all required GitHub API interactions
  - Define success criteria for migration
  - Document rate limits and scaling requirements

### 1.2 Architecture Design

- **System Components**

  ```
  ┌─────────────────┐     ┌──────────────────┐     ┌────────────────┐
  │  GitHub Events  │────▶│ Webhook Handler  │────▶│ Queue Worker   │
  └─────────────────┘     └──────────────────┘     └────────────────┘
           │                       │                        │
           │                       │                        │
           ▼                       ▼                        ▼
  ┌─────────────────┐     ┌──────────────────┐     ┌────────────────┐
  │  GitHub API     │     │   Workers KV     │     │   Claude AI    │
  └─────────────────┘     └──────────────────┘     └────────────────┘
  ```

- **Data Flow Design**
  - Webhook payload processing
  - Queue management system
  - State management strategy
  - Error handling patterns

## Phase 2: Infrastructure Setup

### 2.1 Cloudflare Configuration

- **Workers Setup**

  ```typescript
  // wrangler.toml
  name = "dni-qa-bot";
  main = "src/index.ts";
  compatibility_date = "2024-01-01"[[kv_namespaces]];
  binding = "PR_STATE";
  id = "..."[[queues]];
  binding = "PR_QUEUE";
  name = "pr-processing-queue";
  ```

- **Environment Configuration**
  ```typescript
  interface Env {
    PR_STATE: KVNamespace;
    PR_QUEUE: Queue;
    GITHUB_TOKEN: string;
    WEBHOOK_SECRET: string;
    CLAUDE_API_KEY: string;
  }
  ```

### 2.2 GitHub Integration

- **Webhook Configuration**

  - PR events (opened, synchronized, reopened)
  - Issue comments
  - Review comments
  - Check run events

- **Authentication Setup**
  ```typescript
  const REQUIRED_HEADERS = [
    "x-github-event",
    "x-hub-signature-256",
    "x-github-delivery",
  ];
  ```

## Phase 3: Core Implementation

### 3.1 Webhook Handler

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    try {
      // Validate request
      if (!isValidRequest(request)) {
        return new Response("Invalid request", { status: 400 });
      }

      const payload = await request.json();
      const signature = request.headers.get("X-Hub-Signature-256");

      // Verify webhook signature
      if (!verifyGitHubSignature(payload, signature, env.WEBHOOK_SECRET)) {
        return new Response("Invalid signature", { status: 401 });
      }

      // Process based on event type
      const event = request.headers.get("X-GitHub-Event");
      switch (event) {
        case "pull_request":
          await handlePullRequestEvent(payload, env);
          break;
        case "issue_comment":
          await handleIssueCommentEvent(payload, env);
          break;
        default:
          return new Response("Event not supported", { status: 422 });
      }

      return new Response("Accepted", { status: 202 });
    } catch (error) {
      // Error handling
      ctx.waitUntil(logError(error, env));
      return new Response("Internal error", { status: 500 });
    }
  },
};
```

### 3.2 Queue Worker

```typescript
interface PullRequestJob {
  prNumber: number;
  repository: string;
  sha: string;
  attempt?: number;
}

export default {
  async queue(batch: MessageBatch<PullRequestJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const job = message.body;

      try {
        // Initialize check run
        const checkRun = await createCheckRun(job, env);

        // Run quality checks
        const results = await runQualityChecks(job, env);

        // Update PR status
        await updatePRStatus(job, results, checkRun, env);

        // Store results in KV
        await env.PR_STATE.put(
          `pr:${job.repository}:${job.prNumber}`,
          JSON.stringify(results)
        );

        message.ack();
      } catch (error) {
        // Implement retry logic
        if ((job.attempt || 0) < 3) {
          await env.PR_QUEUE.send({
            ...job,
            attempt: (job.attempt || 0) + 1,
          });
        }
        message.ack();
      }
    }
  },
};
```

## Phase 4: Quality Check Implementation

### 4.1 Core Quality Checks

```typescript
interface QualityCheckResult {
  passed: boolean;
  details: string;
  suggestions?: string[];
}

async function runQualityChecks(
  job: PullRequestJob,
  env: Env
): Promise<QualityCheckResult[]> {
  const checks = [
    validateArticleFormat,
    validateSubmissionGuidelines,
    runAIContentCheck,
    validateReferences,
  ];

  const results = await Promise.all(checks.map((check) => check(job, env)));

  return results;
}
```

### 4.2 Claude AI Integration

```typescript
async function runAIContentCheck(
  job: PullRequestJob,
  env: Env
): Promise<QualityCheckResult> {
  const content = await fetchPRContent(job, env);

  const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.CLAUDE_API_KEY,
    },
    body: JSON.stringify({
      model: "claude-3-opus-20240229",
      messages: [
        {
          role: "user",
          content: `Review this crypto attack article:\n${content}`,
        },
      ],
    }),
  });

  const analysis = await aiResponse.json();
  return processAIResponse(analysis);
}
```

## Phase 5: Scalability & Production Readiness

### 5.1 Performance Optimization

- **Caching Strategy**

  ```typescript
  const CACHE_TTL = 60 * 60; // 1 hour

  async function getCachedResult(key: string, env: Env) {
    const cached = await env.PR_STATE.get(key);
    if (cached) {
      return JSON.parse(cached);
    }
    return null;
  }
  ```

- **Rate Limiting**

  ```typescript
  interface RateLimitConfig {
    max: number;
    window: number;
  }

  const RATE_LIMITS: Record<string, RateLimitConfig> = {
    "github-api": { max: 5000, window: 3600 },
    "claude-api": { max: 100, window: 60 },
  };
  ```

### 5.2 Monitoring & Logging

```typescript
interface LogEntry {
  timestamp: number;
  level: "info" | "warn" | "error";
  event: string;
  data: Record<string, unknown>;
}

async function log(
  entry: Omit<LogEntry, "timestamp">,
  env: Env
): Promise<void> {
  const logEntry: LogEntry = {
    ...entry,
    timestamp: Date.now(),
  };

  // Send to logging service
  await fetch(env.LOG_ENDPOINT, {
    method: "POST",
    body: JSON.stringify(logEntry),
  });
}
```

## Phase 6: Testing & Deployment

### 6.1 Testing Strategy

```typescript
// Jest test example
describe("Webhook Handler", () => {
  it("should validate GitHub signatures", async () => {
    const payload = {
      /* ... */
    };
    const secret = "test-secret";
    const signature = createSignature(payload, secret);

    const result = verifyGitHubSignature(payload, signature, secret);
    expect(result).toBe(true);
  });
});
```

### 6.2 CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Publish
        uses: cloudflare/wrangler-action@2.0.0
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
```

## Production Considerations

### 1. Scalability

- Implement request batching
- Use efficient KV patterns
- Optimize queue processing

### 2. Reliability

- Implement circuit breakers
- Add health checks
- Set up monitoring alerts

### 3. Security

- Regular security audits
- Secret rotation
- Access control reviews

### 4. Cost Management

- Monitor usage metrics
- Optimize resource utilization
- Set up billing alerts

## Timeline

1. Phase 1: 1-2 weeks
2. Phase 2: 1 week
3. Phase 3: 2-3 weeks
4. Phase 4: 2-3 weeks
5. Phase 5: 1-2 weeks
6. Phase 6: 1-2 weeks

Total estimated time: 8-13 weeks

## Success Metrics

- Response time < 100ms for webhook processing
- 99.9% uptime
- < 1% error rate
- Cost reduction compared to GitHub Actions
- Improved PR processing time

## Next Steps

1. Set up development environment
2. Create project repository
3. Configure Cloudflare account
4. Begin Phase 1 implementation
