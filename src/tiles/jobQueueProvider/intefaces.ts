import { JobWithMetadata } from 'pg-boss';

export type ConditionFn = () => boolean | Promise<boolean>;

export interface JobQueueProvider {
  activeQueueName: string;
  consumeQueue: <T, R = void>(fn: (value: JobWithMetadata<T>, jobId?: string) => Promise<R>, conditionFn: ConditionFn) => Promise<void>;
  startQueue: () => void;
  stopQueue: () => void;
}
