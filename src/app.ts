import { Application } from 'express';
import PgBoss from 'pg-boss';
import { ShutdownHandler } from './common/shutdownHandler';
import { registerExternalValues, RegisterOptions } from './containerConfig';
import { ServerBuilder } from './serverBuilder';
import { TilesManager } from './tiles/models/tilesManager';

async function getApp(registerOptions?: RegisterOptions): Promise<Application> {
  const container = await registerExternalValues(registerOptions);
  const app = container.resolve(ServerBuilder).build();
  const pgBoss = container.resolve(PgBoss);
  const tilesManager = container.resolve(TilesManager);
  void pgBoss.work(tilesManager.requestQueueName,{}, tilesManager.handleTileRequest.bind(tilesManager)).catch(console.error);

  return app;
}

export { getApp };
