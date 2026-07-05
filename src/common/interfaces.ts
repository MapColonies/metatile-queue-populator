import { type ConfigSchemaType } from './config';

export interface JobInsertConfig extends Partial<Omit<ConfigSchemaType['queue'], 'retryDelaySeconds'>> {
  retryDelay?: number;
  retentionSeconds?: number;
}
