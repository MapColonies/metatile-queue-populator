import { type vectorMetatileQueuePopulatorFullV1Type } from '@map-colonies/schemas';

export interface JobInsertConfig extends Partial<Omit<vectorMetatileQueuePopulatorFullV1Type['queue'], 'retryDelaySeconds'>> {
  retryDelay?: number;
}
