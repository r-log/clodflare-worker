interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

interface MessageBatch<T> {
  messages: {
    body: T;
    id: string;
    timestamp: number;
    ack(): void;
  }[];
}

interface Queue<T> {
  send(message: T): Promise<void>;
} 