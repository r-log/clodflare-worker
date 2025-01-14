import { Octokit } from "@octokit/rest"
import { Env, PullRequestJob } from "@/types"
import { runQualityChecks } from "@/services/qualityChecks"
import { verifyGitHubWebhook } from "@/utils/webhookVerification"
import { QueueManager } from "@/services/queueManager"

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    console.log("Received webhook request")

    try {
      // Verify GitHub webhook signature
      const rawBody = await request.clone().text()
      const signature = request.headers.get("x-hub-signature-256")

      if (
        !signature ||
        !(await verifyGitHubWebhook(rawBody, signature, env.WEBHOOK_SECRET))
      ) {
        console.error("Invalid signature")
        return new Response("Invalid signature", { status: 401 })
      }

      const payload = JSON.parse(rawBody)
      console.log("Event type:", request.headers.get("x-github-event"))
      console.log("Payload:", payload)

      // Initialize GitHub client
      const octokit = new Octokit({
        auth: env.PAT_TOKEN
      })

      // Process article check request
      if (
        request.headers.get("x-github-event") === "issue_comment" &&
        payload.comment?.body?.includes("/articlecheck")
      ) {
        const job: PullRequestJob = {
          repository: payload.repository.full_name,
          prNumber: payload.issue.number,
          commentId: payload.comment.id
        }

        // Initialize queue manager
        const queueManager = new QueueManager(env)

        // Clean old checks periodically
        ctx.waitUntil(queueManager.cleanOldChecks())

        // Try to enqueue the check
        const { status, isNew } = await queueManager.enqueueCheck(job)

        // If check is already in progress, return status
        if (!isNew) {
          await octokit.issues.createComment({
            owner: payload.repository.owner.login,
            repo: payload.repository.name,
            issue_number: payload.issue.number,
            body: status
          })
          return new Response(status, { status: 200 })
        }

        try {
          // Update status to processing
          await queueManager.updateCheckStatus(job, "processing")

          // Run quality checks
          const results = await runQualityChecks(job, env, octokit)

          // Format and post results
          const comment = formatResults(results)
          await octokit.issues.createComment({
            owner: payload.repository.owner.login,
            repo: payload.repository.name,
            issue_number: payload.issue.number,
            body: comment
          })

          // Update status to completed
          await queueManager.updateCheckStatus(job, "completed", comment)

          return new Response("Article check completed", { status: 200 })
        } catch (error) {
          // Update status to failed
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error occurred"
          await queueManager.updateCheckStatus(job, "failed", errorMessage)
          throw error
        }
      }

      return new Response("OK")
    } catch (error) {
      console.error("Error processing request:", error)
      const message =
        error instanceof Error ? error.message : "Unknown error occurred"
      return new Response(message, { status: 500 })
    }
  }
}

function formatResults(results: any[]): string {
  let comment = "# 🔍 Article Quality Check Results\n\n"

  results.forEach((result, index) => {
    comment += `## Check ${index + 1}\n\n`

    // Status with colored blockquote
    if (result.passed) {
      comment += `> ✅ **Status**: PASS\n\n`
    } else {
      comment += `> ❌ **Status**: FAIL\n\n`
    }

    // Details with colored blockquote based on status
    comment += `**Details**:\n${result.details}\n\n`

    if (result.suggestions && result.suggestions.length > 0) {
      comment += "**💡 Suggestions**:\n"
      result.suggestions.forEach((suggestion: string) => {
        comment += `- ${suggestion}\n`
      })
      comment += "\n"
    }
  })

  // Add footer
  comment += "---\n"
  comment += "_Powered by DNI Article Checker_"

  return comment
}
