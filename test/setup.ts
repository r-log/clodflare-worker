import { vi } from "vitest"

// Mock KV namespace
const mockKV = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn()
}

// Mock Queue
const mockQueue = {
  send: vi.fn()
}

// Mock execution context
const mockCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn()
}

// Global mocks
;(global as any).KVNamespace = mockKV
;(global as any).Queue = mockQueue
;(global as any).ExecutionContext = mockCtx

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks()
})
