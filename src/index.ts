// this import must be called before the first import of tsyringe
import 'reflect-metadata';
import { createServer } from 'http';
import { DependencyContainer } from 'tsyringe';
import { createTerminus } from '@godaddy/terminus';
import { Logger } from '@map-colonies/js-logger';
import { ON_SIGNAL, SERVICES } from '@common/constants';
import { ConfigType } from '@common/config';
import { getApp } from './app';

let container: DependencyContainer | undefined;

void getApp()
  .then(([app, container]) => {
    const logger = container.resolve<Logger>(SERVICES.LOGGER);
    const config = container.resolve<ConfigType>(SERVICES.CONFIG);
    const port = config.get('server.port');
    const stubHealthCheck = async (): Promise<void> => Promise.resolve();
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const server = createTerminus(createServer(app), { healthChecks: { '/liveness': stubHealthCheck }, onSignal: container.resolve(ON_SIGNAL) });

    server.listen(port, () => {
      logger.info(`app started on port ${port}`);
    });
  })
  .catch(async (error: Error) => {
    console.error('😢 - failed initializing the server');
    console.error(error);

    if (container?.isRegistered(ON_SIGNAL) === true) {
      const shutdown = container.resolve<() => Promise<void>>(ON_SIGNAL);
      await shutdown();
    }

    process.exit(1);
  });
