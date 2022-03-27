/* eslint-disable import/first */
// this import must be called before the first import of tsyring
import 'reflect-metadata';
import { createServer } from 'http';
import { createTerminus } from '@godaddy/terminus';
import { container } from 'tsyringe';
import { Logger } from '@map-colonies/js-logger';
import config from 'config';
import { DEFAULT_SERVER_PORT, HEALTHCHECK_SYMBOL, SERVICES } from './common/constants';
import { getApp } from './app';
import { ShutdownHandler } from './common/shutdownHandler';

interface IServerConfig {
  port: string;
}

const serverConfig = config.get<IServerConfig>('server');
const port: number = parseInt(serverConfig.port) || DEFAULT_SERVER_PORT;

void getApp()
  .then(([app]) => {
    const logger = container.resolve<Logger>(SERVICES.LOGGER);
    const stubHealthcheck = async (): Promise<void> => Promise.resolve();
    const shutdownHandler = container.resolve(ShutdownHandler);
    const server = createTerminus(createServer(app), {
      healthChecks: { '/liveness': stubHealthcheck, '/readiness': container.resolve(HEALTHCHECK_SYMBOL) },
      onSignal: shutdownHandler.shutdown.bind(shutdownHandler),
    });

    server.listen(port, () => {
      logger.info(`app started on port ${port}`);
    });
  })
  .catch(async (error: Error) => {
    let logFunction;
    if (container.isRegistered(SERVICES.LOGGER)) {
      const logger = container.resolve<Logger>(SERVICES.LOGGER);
      logFunction = logger.error.bind(logger);
    } else {
      logFunction = console.error;
    }
    logFunction('😢 - failed initializing the server');
    logFunction(error);

    if (container.isRegistered(ShutdownHandler)) {
      const shutdownHandler = container.resolve(ShutdownHandler);
      await shutdownHandler.shutdown();
    }
  });
