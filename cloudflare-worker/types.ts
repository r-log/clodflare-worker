// GitHub related types
export interface PullRequestJob {
  repository: string
  prNumber: number
  commentId?: number
}

// Quality check related types
export interface QualityCheckResult {
  passed: boolean
  details: string
  suggestions?: string[]
}

// Queue related types
export interface QueuedCheck {
  repository: string
  prNumber: number
  commentId?: number
  timestamp: number
  status: "pending" | "processing" | "completed" | "failed"
  result?: string
}

// Rate limit related types
export interface RateLimitState {
  requestCount: number
  inputTokens: number
  outputTokens: number
  timestamp: number
}

// API Response types
export interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// Environment configuration
export interface Env {
  PR_STATE: KVNamespace
  WEBHOOK_SECRET: string
  PAT_TOKEN: string
  OPENROUTER_API_KEY: string
  ENVIRONMENT: string
}
