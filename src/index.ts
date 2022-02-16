/* eslint-disable import/first */
// this import must be called before the first import of tsyring
import 'reflect-metadata';
import { createServer } from 'http';
import { createTerminus } from '@godaddy/terminus';
import { Logger } from '@map-colonies/js-logger';
import { container } from 'tsyringe';
import config from 'config';
import { DEFAULT_SERVER_PORT, SERVICES } from './common/constants';

import { getApp } from './app';
import { ShutdownHandler } from './common/shutdownHandler';

interface IServerConfig {
  port: string;
}

const serverConfig = config.get<IServerConfig>('server');
const port: number = parseInt(serverConfig.port) || DEFAULT_SERVER_PORT;

void getApp()
  .then((app) => {
    const logger = container.resolve<Logger>(SERVICES.LOGGER);
    const stubHealthcheck = async (): Promise<void> => Promise.resolve();
    const shutdownHandler = container.resolve(ShutdownHandler);
    const server = createTerminus(createServer(app), {
      healthChecks: { '/liveness': stubHealthcheck },
      onSignal: shutdownHandler.shutdown.bind(shutdownHandler),
    });

    server.listen(port, () => {
      logger.info(`app started on port ${port}`);
    });
  })
  .catch(async (error: Error) => {
    console.error('😢 - failed initializing the server');
    console.error(error);

    if (container.isRegistered(ShutdownHandler)) {
      const shutdownHandler = container.resolve(ShutdownHandler);
      await shutdownHandler.shutdown();
    }
  });
