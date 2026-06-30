import { Logger } from '@map-colonies/js-logger';
import { type PgBoss } from 'pg-boss';
import { FactoryFunction } from 'tsyringe';
import { JOB_QUEUE_PROVIDER, SERVICES } from './common/constants';
import { PgBossJobQueueProvider } from './tiles/jobQueueProvider/pgBossJobQueue';
import { TileRequestQueuePayload } from './tiles/models/tiles';
import { TilesManager } from './tiles/models/tilesManager';
import { ConfigType } from './common/config';
import { PGBOSS_PROVIDER } from './tiles/jobQueueProvider/pgbossFactory';
import { type ConditionFn } from './tiles/jobQueueProvider/intefaces';
import { LOW_WATER_MARK_RATIO } from './common/constants';

export const consumeAndPopulateFactory: FactoryFunction<() => Promise<void>> = (container) => {
  const logger = container.resolve<Logger>(SERVICES.LOGGER);
  const config = container.resolve<ConfigType>(SERVICES.CONFIG);
  const pgBoss = container.resolve<PgBoss>(PGBOSS_PROVIDER);
  const queueProv = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
  const tilesManager = container.resolve(TilesManager);
  const appConfig = config.get('app');

  let conditionFn: ConditionFn | undefined = undefined;

  if (appConfig.consumeCondition.enabled) {
    const highWaterMark = appConfig.consumeCondition.tilesQueueSizeLimit;
    const lowWaterMark = Math.floor(highWaterMark * LOW_WATER_MARK_RATIO);
    let isPaused = false;

    conditionFn = async (): Promise<boolean> => {
      const { queuedCount } = await pgBoss.getQueueStats(tilesManager.tilesQueueName);

      if (!isPaused && queuedCount >= highWaterMark) {
        isPaused = true;
        logger.info({ msg: 'tiles queue reached high water mark, pausing consumption', queuedCount, highWaterMark });
      } else if (isPaused && queuedCount < lowWaterMark) {
        isPaused = false;
        logger.info({ msg: 'tiles queue dropped below low water mark, resuming consumption', queuedCount, lowWaterMark });
      }

      logger.debug({ msg: 'consume condition check', queueName: tilesManager.tilesQueueName, queuedCount, isPaused, highWaterMark, lowWaterMark });
      return !isPaused;
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
