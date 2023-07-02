import config from 'config';
import { getOtelMixin } from '@map-colonies/telemetry';
import { trace } from '@opentelemetry/api';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import jsLogger, { LoggerOptions } from '@map-colonies/js-logger';
import PgBoss from 'pg-boss';
import { instanceCachingFactory, instancePerContainerCachingFactory } from 'tsyringe';
import client from 'prom-client';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { HEALTHCHECK_SYMBOL, ON_SIGNAL, SERVICES, SERVICE_NAME } from './common/constants';
import { tracing } from './common/tracing';
import { tilesRouterFactory, TILES_ROUTER_SYMBOL } from './tiles/routes/tilesRouter';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { DbConfig, pgBossFactory } from './common/pgbossFactory';
import { TilesManager } from './tiles/models/tilesManager';
import { AppConfig, IConfig } from './common/interfaces';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const cleanupRegistry = new CleanupRegistry();

  try {
    const loggerConfig = config.get<LoggerOptions>('telemetry.logger');
    const logger = jsLogger({ ...loggerConfig, mixin: getOtelMixin() });

    cleanupRegistry.on('itemFailed', (id, error, msg) => logger.error({ msg, itemId: id, err: error }));
    cleanupRegistry.on('finished', (status) => logger.info({ msg: `cleanup registry finished cleanup`, status }));

    const pgBoss = await pgBossFactory(config.get<DbConfig>('db'));
    cleanupRegistry.register({ func: pgBoss.stop.bind(pgBoss) });
    pgBoss.on('error', logger.error.bind(logger));
    await pgBoss.start();

    const tracer = trace.getTracer(SERVICE_NAME);
    cleanupRegistry.register({ func: tracing.stop.bind(tracing), id: SERVICES.TRACER });

    const dependencies: InjectionObject<unknown>[] = [
      { token: SERVICES.CONFIG, provider: { useValue: config } },
      { token: SERVICES.LOGGER, provider: { useValue: logger } },
      { token: SERVICES.TRACER, provider: { useValue: tracer } },
      {
        token: SERVICES.METRICS_REGISTRY,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const config = container.resolve<IConfig>(SERVICES.CONFIG);
            const appConfig = config.get<AppConfig>('app');

            client.register.setDefaultLabels({
              project: appConfig.projectName,
              metatileSize: appConfig.metatileSize,
            });
            return client.register;
          }),
        },
      },
      { token: PgBoss, provider: { useValue: pgBoss } },
      {
        token: HEALTHCHECK_SYMBOL,
        provider: {
          useFactory: instanceCachingFactory((container) => {
            const tilesManager = container.resolve(TilesManager);
            return tilesManager.isAlive.bind(tilesManager);
          }),
        },
      },
      { token: TILES_ROUTER_SYMBOL, provider: { useFactory: tilesRouterFactory } },
      {
        token: SERVICES.CLEANUP_REGISTRY,
        provider: { useValue: cleanupRegistry },
      },
      {
        token: ON_SIGNAL,
        provider: {
          useValue: cleanupRegistry.trigger.bind(cleanupRegistry),
        },
      },
    ];

    return registerDependencies(dependencies, options?.override, options?.useChild);
  } catch (error) {
    await cleanupRegistry.trigger();
    throw error;
  }
};
