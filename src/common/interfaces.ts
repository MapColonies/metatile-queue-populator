import { type vectorMetatileQueuePopulatorV1Type } from '@map-colonies/schemas';

export interface JobInsertConfig extends Partial<Omit<vectorMetatileQueuePopulatorV1Type['queue'], 'retryDelaySeconds'>> {
  retryDelay?: number;
}
