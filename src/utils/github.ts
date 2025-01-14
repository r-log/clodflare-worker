import { createHmac } from 'crypto';

export async function verifyGitHubSignature(
  payload: unknown,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const payloadStr = JSON.stringify(payload);
    const hmac = createHmac('sha256', secret);
    const digest = hmac.update(payloadStr).digest('hex');
    const computedSignature = `sha256=${digest}`;
    
    return signature === computedSignature;
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
} 