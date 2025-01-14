// Extend ServiceWorkerGlobalScope
declare global {
  // Extend the global scope for Cloudflare Workers
  const ENVIRONMENT: string

  interface ServiceWorkerGlobalScope {
    // Add any global variables provided by Cloudflare
    ENVIRONMENT: string
  }
}

// Declare KV namespace types
interface KVNamespace {
  get(
    key: string,
    options?: Partial<KVNamespaceGetOptions<any>>
  ): Promise<string | null>
  put(
    key: string,
    value: string | ReadableStream | ArrayBuffer,
    options?: KVNamespacePutOptions
  ): Promise<void>
  delete(key: string): Promise<void>
  list(
    options?: KVNamespaceListOptions
  ): Promise<KVNamespaceListResult<unknown>>
}

// KV namespace options
interface KVNamespaceGetOptions<T> {
  type: "text" | "json" | "arrayBuffer" | "stream"
  cacheTtl?: number
}

interface KVNamespacePutOptions {
  expiration?: number
  expirationTtl?: number
}

interface KVNamespaceListOptions {
  prefix?: string
  limit?: number
  cursor?: string
}

interface KVNamespaceListResult<T> {
  keys: Array<{
    name: string
    expiration?: number
    metadata?: T
  }>
  list_complete: boolean
  cursor?: string
}

// Ensure this is treated as a module
export {}
