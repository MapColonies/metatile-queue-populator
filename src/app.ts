import { Application } from 'express';
import PgBoss from 'pg-boss';
import { DependencyContainer } from 'tsyringe';
import { SERVICES } from './common/constants';
import { IConfig } from './common/interfaces';
import { ShutdownHandler } from './common/shutdownHandler';
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
    const shutdownHandler = container.resolve(ShutdownHandler);
    const workerId = await pgBoss.work(
      tilesManager.requestQueueName,
      { newJobCheckIntervalSeconds: config.get('app.requestQueueCheckIntervalSec') },
      tilesManager.handleTileRequest.bind(tilesManager)
    );
    shutdownHandler.addFunction(async () => pgBoss.offWork(workerId));
  }

  return [app, container];
}

export { getApp };
