import { Logger } from '@map-colonies/js-logger';
import PgBoss from 'pg-boss';
import { FactoryFunction } from 'tsyringe';
import { JOB_QUEUE_PROVIDER, SERVICES } from './common/constants';
import { PgBossJobQueueProvider } from './tiles/jobQueueProvider/pgBossJobQueue';
import { TileRequestQueuePayload } from './tiles/models/tiles';
import { TilesManager } from './tiles/models/tilesManager';
import { ConfigType } from './common/config';
import { PGBOSS_PROVIDER } from './tiles/jobQueueProvider/pgbossFactory';
import { type ConditionFn } from './tiles/jobQueueProvider/intefaces';

export const consumeAndPopulateFactory: FactoryFunction<() => Promise<void>> = (container) => {
  const logger = container.resolve<Logger>(SERVICES.LOGGER);
  const config = container.resolve<ConfigType>(SERVICES.CONFIG);
  const pgBoss = container.resolve<PgBoss>(PGBOSS_PROVIDER);
  const queueProv = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
  const tilesManager = container.resolve(TilesManager);
  const appConfig = config.get('app');

  let conditionFn: ConditionFn | undefined = undefined;

  if (appConfig.consumeCondition.enabled) {
    conditionFn = async (): Promise<boolean> => {
      const currentSize = await pgBoss.getQueueSize(tilesManager.tilesQueueName, { before: 'completed' });
      logger.debug({ msg: 'condition function', queueName: tilesManager.tilesQueueName, size: currentSize });
      return currentSize <= (appConfig.consumeCondition.tilesQueueSizeLimit ?? Number.NEGATIVE_INFINITY);
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
