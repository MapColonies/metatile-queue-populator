import { type vectorMetatileQueuePopulatorFullV2Type } from '@map-colonies/schemas';

export interface JobInsertConfig extends Partial<Omit<vectorMetatileQueuePopulatorFullV2Type['queue'], 'retryDelaySeconds'>> {
  retryDelay?: number;
  retentionSeconds?: number;
}
