import { PullRequestJob, Env } from "../types"

export interface QueuedCheck {
  repository: string
  prNumber: number
  commentId?: number
  timestamp: number
  status: "pending" | "processing" | "completed" | "failed"
  result?: string
}

export class QueueManager {
  constructor(private env: Env) {}

  private getQueueKey(job: PullRequestJob): string {
    return `queue:${job.repository}:${job.prNumber}`
  }

  async enqueueCheck(
    job: PullRequestJob
  ): Promise<{ status: string; isNew: boolean }> {
    const queueKey = this.getQueueKey(job)
    const existing = await this.env.PR_STATE.get(queueKey)

    if (existing) {
      const check = JSON.parse(existing) as QueuedCheck
      const now = Date.now()

      // If check is in progress
      if (check.status !== "completed" && check.status !== "failed") {
        return {
          status: `> ⏳ **Article Check Status**: Check already in progress\n\nCurrent status: \`${check.status}\``,
          isNew: false
        }
      }

      // Add 5-minute cooldown between checks
      const cooldownPeriod = 5 * 60 * 1000 // 5 minutes in milliseconds
      if (now - check.timestamp < cooldownPeriod) {
        const waitTime = Math.ceil(
          (cooldownPeriod - (now - check.timestamp)) / 1000
        )
        return {
          status: `> ⏰ **Cooldown Period**\n\nPlease wait \`${waitTime}\` seconds before requesting another check.\n\n_This helps prevent API rate limits and ensures thorough analysis._`,
          isNew: false
        }
      }
    }

    const newCheck: QueuedCheck = {
      repository: job.repository,
      prNumber: job.prNumber,
      commentId: job.commentId,
      timestamp: Date.now(),
      status: "pending"
    }

    await this.env.PR_STATE.put(queueKey, JSON.stringify(newCheck))
    return {
      status: `> 🔄 **Article Check Started**\n\nYour request has been queued and will be processed shortly.`,
      isNew: true
    }
  }

  async updateCheckStatus(
    job: PullRequestJob,
    status: QueuedCheck["status"],
    result?: string
  ): Promise<void> {
    const queueKey = this.getQueueKey(job)
    const existing = await this.env.PR_STATE.get(queueKey)

    if (!existing) {
      throw new Error("QueueManager: Check not found in queue")
    }

    const check = JSON.parse(existing) as QueuedCheck
    check.status = status
    if (result) {
      check.result = result
    }

    await this.env.PR_STATE.put(queueKey, JSON.stringify(check))
  }

  async getQueueStatus(job: PullRequestJob): Promise<QueuedCheck | null> {
    const queueKey = this.getQueueKey(job)
    const existing = await this.env.PR_STATE.get(queueKey)
    return existing ? JSON.parse(existing) : null
  }

  async cleanOldChecks(): Promise<void> {
    // Clean checks older than 1 hour
    const oneHourAgo = Date.now() - 3600000
    const list = await this.env.PR_STATE.list({ prefix: "queue:" })

    for (const key of list.keys) {
      const check = JSON.parse(
        (await this.env.PR_STATE.get(key.name)) as string
      ) as QueuedCheck
      if (check.timestamp < oneHourAgo) {
        await this.env.PR_STATE.delete(key.name)
      }
    }
  }
}
