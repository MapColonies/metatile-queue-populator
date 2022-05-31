/* eslint-disable import/first */
// this import must be called before the first import of tsyring
import 'reflect-metadata';
import { createServer } from 'http';
import { createTerminus } from '@godaddy/terminus';
import { Logger } from '@map-colonies/js-logger';
import config from 'config';
import { DependencyContainer } from 'tsyringe';
import { DEFAULT_SERVER_PORT, HEALTHCHECK_SYMBOL, SERVICES } from './common/constants';
import { getApp } from './app';
import { ShutdownHandler } from './common/shutdownHandler';

let depContainer: DependencyContainer | undefined;

const port: number = config.get<number>('server.port') || DEFAULT_SERVER_PORT;

void getApp()
  .then(([app, container]) => {
    depContainer = container;

    const logger = depContainer.resolve<Logger>(SERVICES.LOGGER);
    const stubHealthcheck = async (): Promise<void> => Promise.resolve();
    const shutdownHandler = depContainer.resolve(ShutdownHandler);
    const server = createTerminus(createServer(app), {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      healthChecks: { '/liveness': stubHealthcheck, '/readiness': depContainer.resolve(HEALTHCHECK_SYMBOL) },
      onSignal: shutdownHandler.shutdown.bind(shutdownHandler),
    });

    server.listen(port, () => {
      logger.info(`app started on port ${port}`);
    });
  })
  .catch(async (error: Error) => {
    let logFunction;
    if (depContainer?.isRegistered(SERVICES.LOGGER) === true) {
      const logger = depContainer.resolve<Logger>(SERVICES.LOGGER);
      logFunction = logger.error.bind(logger);
    } else {
      logFunction = console.error;
    }
    logFunction({ msg: '😢 - failed initializing the server', err: error });

    if (depContainer?.isRegistered(ShutdownHandler) === true) {
      const shutdownHandler = depContainer.resolve(ShutdownHandler);
      await shutdownHandler.shutdown();
    }
  });
