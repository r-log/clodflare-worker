import { Octokit } from "@octokit/rest"
import { PullRequestJob, QualityCheckResult, Env } from "../types"

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
}

// Rate limiting configuration
const RATE_LIMITS = {
  requestsPerMinute: 5,
  inputTokensPerMinute: 10000,
  outputTokensPerMinute: 2000
}

// Simple token counting approximation (1 token ≈ 4 characters)
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

interface RateLimitState {
  requestCount: number
  inputTokens: number
  outputTokens: number
  timestamp: number
}

async function getRateLimitState(env: Env): Promise<RateLimitState> {
  const state = await env.PR_STATE.get("rate_limit")
  if (!state) {
    return {
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      timestamp: Date.now()
    }
  }
  return JSON.parse(state)
}

async function updateRateLimitState(
  state: RateLimitState,
  env: Env
): Promise<void> {
  await env.PR_STATE.put("rate_limit", JSON.stringify(state))
}

async function checkRateLimit(tokenCount: number, env: Env): Promise<void> {
  const state = await getRateLimitState(env)
  const now = Date.now()

  // Reset counters if a minute has passed
  if (now - state.timestamp >= 60000) {
    state.requestCount = 0
    state.inputTokens = 0
    state.outputTokens = 0
    state.timestamp = now
  }

  // Check limits
  if (state.requestCount >= RATE_LIMITS.requestsPerMinute) {
    throw new Error("Rate limit exceeded: Too many requests per minute")
  }
  if (state.inputTokens + tokenCount >= RATE_LIMITS.inputTokensPerMinute) {
    throw new Error("Rate limit exceeded: Too many input tokens per minute")
  }

  // Update counters
  state.requestCount++
  state.inputTokens += tokenCount

  await updateRateLimitState(state, env)
}

async function fetchPRContent(
  job: PullRequestJob,
  octokit: Octokit
): Promise<string> {
  const [owner, repo] = job.repository.split("/")
  const { data: pullRequest } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: job.prNumber
  })

  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: job.prNumber
  })

  // Get the content of added/modified markdown files
  const markdownFiles = files.filter(
    (file) =>
      (file.status === "added" || file.status === "modified") &&
      file.filename.endsWith(".md")
  )

  if (markdownFiles.length === 0) {
    throw new Error("No markdown files found in the pull request")
  }

  // For now, we'll just check the first markdown file
  const file = markdownFiles[0]
  const { data: content } = await octokit.repos.getContent({
    owner,
    repo,
    path: file.filename,
    ref: pullRequest.head.sha
  })

  if ("content" in content) {
    return atob(content.content.replace(/\n/g, ""))
  }

  throw new Error("Could not fetch file content")
}

async function validateWithOpenRouter(
  content: string,
  env: Env
): Promise<QualityCheckResult> {
  const inputTokenCount = estimateTokenCount(content)
  await checkRateLimit(inputTokenCount, env)

  const prompt = `Review this crypto attack article for quality and accuracy. The article should PASS only if it meets ALL of the following criteria:

1. Clear attack description including:
   - Date and target protocol clearly identified
   - Attack vector specifically named and explained
   - Step-by-step attack flow with technical details
   - Clear timeline of events with UTC timestamps

2. Technical analysis must have:
   - Vulnerable code snippets with proper syntax highlighting
   - Exploit code or detailed attack mechanism
   - Clear explanation of the vulnerability root cause
   - Specific security principles or patterns that were violated

3. Impact assessment including:
   - Exact financial losses in USD and cryptocurrency amounts
   - Number of affected users/accounts with specifics
   - Market impact (TVL change, token price effects)
   - Broader ecosystem implications

4. References must include:
   - Transaction hash(es) with links
   - Official protocol post-mortem
   - Independent security analysis from reputable firms
   - All links must be properly formatted and accessible

5. Mitigation details including:
   - Fixed/patched code examples
   - Specific security improvements implemented
   - Timeline of fixes and updates
   - Measures to prevent similar attacks

Article content:
${content}

Provide a structured review with:
1. Overall assessment (PASS only if ALL criteria are met, otherwise FAIL)
2. Detailed feedback for each criterion, citing specific examples from the article
3. Specific, actionable suggestions for improvement
4. List of any missing critical information

Be strict in the assessment - if any criterion is not fully met, the overall result should be FAIL.
Ensure code blocks have proper syntax highlighting (e.g. \`\`\`solidity).
Verify all dates are in UTC and properly formatted.
Check that all reference links are properly formatted markdown links.`

  console.log("Making request to OpenRouter API...")

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://github.com/r-log/clodflare-worker",
        "X-Title": "DNI Article Checker"
      },
      body: JSON.stringify({
        model: "openai/gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content:
              "You are a technical article reviewer specializing in cryptocurrency and blockchain security. Your task is to review articles about crypto attacks for quality, accuracy, and completeness. Be extremely thorough and strict in your assessment, requiring detailed technical information and proper formatting."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    }
  )

  console.log("OpenRouter API response status:", response.status)
  console.log(
    "OpenRouter API response headers:",
    Object.fromEntries(response.headers.entries())
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error("OpenRouter API error response:", errorText)
    throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`)
  }

  console.log("Parsing OpenRouter API response...")
  const result = (await response.json()) as OpenRouterResponse
  console.log("OpenRouter API response parsed successfully")
  console.log("OpenRouter API response:", JSON.stringify(result, null, 2))

  if (!result.choices?.[0]?.message?.content) {
    console.error("Unexpected OpenRouter API response structure:", result)
    throw new Error("Invalid response structure from OpenRouter API")
  }

  console.log("Extracting analysis from response...")
  const analysis = result.choices[0].message.content
  const outputTokensThisMinute = estimateTokenCount(analysis)

  // Parse response
  const passed = analysis.toLowerCase().includes("pass")
  const suggestions = analysis
    .split("\n")
    .filter((line: string) => line.trim().startsWith("-"))
    .map((line: string) => line.trim().substring(2))

  // After getting the response, update output tokens
  const state = await getRateLimitState(env)
  state.outputTokens += outputTokensThisMinute
  if (state.outputTokens >= RATE_LIMITS.outputTokensPerMinute) {
    throw new Error("Rate limit exceeded: Too many output tokens per minute")
  }
  await updateRateLimitState(state, env)

  return {
    passed,
    details: analysis,
    suggestions: suggestions.length > 0 ? suggestions : undefined
  }
}

export async function runQualityChecks(
  job: PullRequestJob,
  env: Env,
  octokit: Octokit
): Promise<QualityCheckResult[]> {
  try {
    // Fetch PR content
    const content = await fetchPRContent(job, octokit)

    // Run checks
    const results: QualityCheckResult[] = []

    // 1. Claude AI Analysis via OpenRouter
    const claudeResult = await validateWithOpenRouter(content, env)
    results.push(claudeResult)

    // 2. Basic Markdown Structure Check
    const structureResult = validateMarkdownStructure(content)
    results.push(structureResult)

    return results
  } catch (error) {
    console.error("Error running quality checks:", error)
    throw error
  }
}

function validateMarkdownStructure(content: string): QualityCheckResult {
  const requiredSections = [
    "# ", // Title
    "## Overview",
    "## Attack Details",
    "## Technical Analysis",
    "## Impact",
    "## References",
    "## Timeline",
    "## Mitigation"
  ]

  const missingStructure = requiredSections.filter(
    (section) => !content.toLowerCase().includes(section.toLowerCase())
  )

  // Check for code blocks with syntax highlighting
  const codeBlocks = content.match(/```\w+[\s\S]*?```/g) || []
  const hasProperCodeBlocks =
    codeBlocks.length > 0 &&
    codeBlocks.every(
      (block) =>
        block.startsWith("```solidity") ||
        block.startsWith("```typescript") ||
        block.startsWith("```javascript") ||
        block.startsWith("```python")
    )

  // Check for proper reference links
  const links = content.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []
  const hasProperLinks = links.length >= 3 // Minimum 3 references required

  // Check for dates in UTC format
  const hasUTCDates = (content.match(/\d{2}:\d{2}\s*UTC/g)?.length ?? 0) > 0

  const suggestions: string[] = []
  if (missingStructure.length > 0) {
    suggestions.push(`Add missing sections: ${missingStructure.join(", ")}`)
  }
  if (!hasProperCodeBlocks) {
    suggestions.push(
      "Ensure all code blocks have proper syntax highlighting (e.g. ```solidity)"
    )
  }
  if (!hasProperLinks) {
    suggestions.push("Add at least 3 properly formatted reference links")
  }
  if (!hasUTCDates) {
    suggestions.push("Include timestamps in UTC format (e.g. 14:30 UTC)")
  }

  return {
    passed:
      missingStructure.length === 0 &&
      hasProperCodeBlocks &&
      hasProperLinks &&
      hasUTCDates,
    details:
      missingStructure.length === 0 &&
      hasProperCodeBlocks &&
      hasProperLinks &&
      hasUTCDates
        ? "Article structure meets all requirements"
        : "Article structure needs improvements",
    suggestions: suggestions.length > 0 ? suggestions : undefined
  }
}
