type PersistenceOperation = () => Promise<void>;

const queues = new Map<string, Promise<void>>();

export async function enqueueChatJobPersistence(jobId: string, operation: PersistenceOperation): Promise<void> {
  const previous = queues.get(jobId) ?? Promise.resolve();
  const next = previous.then(operation);
  const settled = next.catch(() => undefined);
  queues.set(jobId, settled);

  try {
    await next;
  } finally {
    if (queues.get(jobId) === settled) queues.delete(jobId);
  }
}

export async function waitForChatJobPersistence(jobId: string): Promise<void> {
  await (queues.get(jobId) ?? Promise.resolve());
}
