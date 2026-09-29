import { type ChatStreamEvent } from '../chat.service';

interface PendingResult<T> {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: unknown) => void;
}

/**
 * AsyncEventQueue 是“生产者/消费者桥”：
 * - 生产者：LangGraph node 通过 push 发出 sources/delta/done/error；
 * - 消费者：ChatService 仍用 AsyncGenerator 逐个 yield 给 Controller。
 * 好处是 Controller 不需要知道 LangGraph；SSE 协议和 D3 保持一致。
 */
export class AsyncEventQueue<T> {
  private readonly queue: T[] = [];
  private readonly waiters: Array<PendingResult<T>> = [];
  private ended = false;
  private failure: unknown;

  /** Node 内只调用同步 push；不要把 Promise 或 stream 对象放进 State。 */
  push(event: T): void {
    if (this.ended) {
      throw new Error('事件队列已经关闭，不能再写入事件');
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value: event, done: false });
      return;
    }
    this.queue.push(event);
  }

  /** 正常结束：graph.invoke 完成后调用，消费者读到 done:true。 */
  close(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters) {
      waiter.resolve({ value: undefined, done: true });
    }
    this.waiters.length = 0;
  }

  /** 图外层发生未捕获异常时，让 AsyncGenerator 抛错，Controller 的兜底 error 生效。 */
  fail(error: unknown): void {
    if (this.ended) return;
    this.ended = true;
    this.failure = error;
    for (const waiter of this.waiters) {
      waiter.reject(error);
    }
    this.waiters.length = 0;
  }

  /** 消费端入口；空队列时挂起，push/close/fail 到来时恢复。 */
  async next(): Promise<IteratorResult<T>> {
    const event = this.queue.shift();
    if (event !== undefined) {
      return { value: event, done: false };
    }
    if (this.failure !== undefined) {
      throw this.failure;
    }
    if (this.ended) {
      return { value: undefined, done: true };
    }

    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  /** 让 ChatService 可以用 for-await 消费。 */
  async *stream(): AsyncGenerator<T> {
    while (true) {
      const result = await this.next();
      if (result.done) return;
      yield result.value;
    }
  }
}
