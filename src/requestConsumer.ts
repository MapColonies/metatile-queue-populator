import { Logger } from '@map-colonies/js-logger';
import { IConfig } from 'config';
import PgBoss from 'pg-boss';
import { FactoryFunction } from 'tsyringe';
import { JOB_QUEUE_PROVIDER, SERVICES } from './common/constants';
import { AppConfig } from './common/interfaces';
import { PgBossJobQueueProvider } from './tiles/jobQueueProvider/pgBossJobQueue';
import { TileRequestQueuePayload } from './tiles/models/tiles';
import { TilesManager } from './tiles/models/tilesManager';

export const consumeAndPopulateFactory: FactoryFunction<() => Promise<void>> = (container) => {
  const logger = container.resolve<Logger>(SERVICES.LOGGER);
  const config = container.resolve<IConfig>(SERVICES.CONFIG);
  const pgBoss = container.resolve(PgBoss);
  const queueProv = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
  const tilesManager = container.resolve(TilesManager);
  const appConfig = config.get<AppConfig>('app');

  let conditionFn: (() => boolean | Promise<boolean>) | undefined = undefined;

  if (appConfig.consumeDelay.enabled) {
    conditionFn = async (): Promise<boolean> => {
      const currentSize = await pgBoss.getQueueSize(tilesManager.tilesQueueName, { before: 'completed' });
      logger.debug({ msg: 'condition function', queueName: tilesManager.tilesQueueName, size: currentSize });
      return currentSize <= appConfig.consumeDelay.tilesQueueSizeLimit;
    };
  }

  const consumeAndPopulate = async (): Promise<void> => {
    await queueProv.consumeQueue<TileRequestQueuePayload>(async (job) => {
      logger.info({ msg: 'started processing request', jobId: job.id, source: job.data.source });

      await tilesManager.handleTileRequest(job);

      logger.info({ msg: 'processing request completed successfully', jobId: job.id, source: job.data.source });
    }, conditionFn);
  };

  return consumeAndPopulate;
};
