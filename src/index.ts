import { Env, PullRequestJob } from './types';
import { Octokit } from '@octokit/rest';
import Anthropic from '@anthropic-ai/sdk';
import { verifyGitHubSignature } from './utils/github';
import { runQualityChecks } from './services/qualityChecks';
import { createPRComment } from './services/github';

// Required headers for GitHub webhook
const REQUIRED_HEADERS = [
  'x-github-event',
  'x-hub-signature-256',
  'x-github-delivery'
];

export default {
  // Handle incoming webhook requests
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      // Validate request method
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      // Validate required headers
      for (const header of REQUIRED_HEADERS) {
        if (!request.headers.has(header)) {
          return new Response(`Missing ${header} header`, { status: 400 });
        }
      }

      const payload = await request.json();
      const signature = request.headers.get('x-hub-signature-256');
      
      // Verify webhook signature
      if (!await verifyGitHubSignature(payload, signature!, env.WEBHOOK_SECRET)) {
        return new Response('Invalid signature', { status: 401 });
      }

      // Check if this is a PR comment with /articlecheck
      if (
        request.headers.get('x-github-event') === 'issue_comment' &&
        payload.issue?.pull_request &&
        payload.comment?.body?.includes('/articlecheck')
      ) {
        // Queue the job for processing
        await env.PR_QUEUE.send({
          prNumber: payload.issue.number,
          repository: payload.repository.full_name,
          sha: payload.issue.pull_request.head?.sha
        });

        return new Response('Article check queued', { status: 202 });
      }

      return new Response('Event not supported', { status: 422 });
    } catch (error) {
      // Log error
      console.error('Error processing webhook:', error);
      return new Response('Internal server error', { status: 500 });
    }
  },

  // Process queued jobs
  async queue(batch: MessageBatch<PullRequestJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const job = message.body;
        
        // Initialize clients
        const octokit = new Octokit({ auth: env.GITHUB_TOKEN });
        const anthropic = new Anthropic({ apiKey: env.CLAUDE_API_KEY });

        // Run quality checks
        const results = await runQualityChecks(job, env, octokit, anthropic);
        
        // Post results as PR comment
        await createPRComment(job, results, octokit);
        
        // Store results in KV
        await env.PR_STATE.put(
          `pr:${job.repository}:${job.prNumber}`,
          JSON.stringify(results)
        );

        message.ack();
      } catch (error) {
        // Implement retry logic
        if ((message.body.attempt || 0) < 3) {
          await env.PR_QUEUE.send({
            ...message.body,
            attempt: (message.body.attempt || 0) + 1
          });
        }
        message.ack();
      }
    }
  }
}; 