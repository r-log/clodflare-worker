export async function verifyGitHubWebhook(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signedMessage = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  )
  const expectedSignature =
    "sha256=" +
    Array.from(new Uint8Array(signedMessage))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  return expectedSignature === signature
}
