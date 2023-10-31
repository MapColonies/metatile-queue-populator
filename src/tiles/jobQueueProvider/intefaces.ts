import { JobWithMetadata } from 'pg-boss';

export interface JobQueueProvider {
  activeQueueName: string;
  consumeQueue: <T, R = void>(fn: (value: JobWithMetadata<T>, jobId?: string) => Promise<R>, conditionFn: () => boolean) => Promise<void>;
  startQueue: () => void;
  stopQueue: () => void;
}
