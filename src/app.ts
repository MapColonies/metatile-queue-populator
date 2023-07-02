import { Application } from 'express';
import PgBoss from 'pg-boss';
import { DependencyContainer } from 'tsyringe';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { SERVICES } from './common/constants';
import { IConfig } from './common/interfaces';
import { registerExternalValues, RegisterOptions } from './containerConfig';
import { ServerBuilder } from './serverBuilder';
import { TilesManager } from './tiles/models/tilesManager';

async function getApp(registerOptions?: RegisterOptions): Promise<[Application, DependencyContainer]> {
  const container = await registerExternalValues(registerOptions);
  const app = container.resolve(ServerBuilder).build();
  const config = container.resolve<IConfig>(SERVICES.CONFIG);

  if (config.get<boolean>('app.enableRequestQueueHandling')) {
    const pgBoss = container.resolve(PgBoss);
    const tilesManager = container.resolve(TilesManager);
    const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);

    const workerId = await pgBoss.work(
      tilesManager.requestQueueName,
      { newJobCheckIntervalSeconds: config.get('app.requestQueueCheckIntervalSec') },
      tilesManager.handleTileRequest.bind(tilesManager)
    );
    cleanupRegistry.register({ func: async () => pgBoss.offWork(workerId) });
  }

  return [app, container];
}

export { getApp };
