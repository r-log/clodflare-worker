export interface Env {
  // KV Namespace
  PR_STATE: KVNamespace;
  
  // Queue
  PR_QUEUE: Queue<PullRequestJob>;
  
  // Environment variables
  GITHUB_TOKEN: string;
  WEBHOOK_SECRET: string;
  CLAUDE_API_KEY: string;
  BRAVE_SEARCH_API_KEY: string;
  ENVIRONMENT: string;
}

export interface PullRequestJob {
  prNumber: number;
  repository: string;
  sha: string;
  attempt?: number;
}

export interface QualityCheckResult {
  passed: boolean;
  details: string;
  suggestions?: string[];
}

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  event: string;
  data: Record<string, unknown>;
} 