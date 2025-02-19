import { getOtelMixin } from '@map-colonies/telemetry';
import { trace } from '@opentelemetry/api';
import { DependencyContainer, Lifecycle, instanceCachingFactory, instancePerContainerCachingFactory } from 'tsyringe';
import jsLogger from '@map-colonies/js-logger';
import PgBoss from 'pg-boss';
import client from 'prom-client';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { CONSUME_AND_POPULATE_FACTORY, HEALTHCHECK_SYMBOL, JOB_QUEUE_PROVIDER, ON_SIGNAL, SERVICES, SERVICE_NAME } from './common/constants';
import { tilesRouterFactory, TILES_ROUTER_SYMBOL } from './tiles/routes/tilesRouter';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { pgBossFactory } from './tiles/jobQueueProvider/pgbossFactory';
import { TilesManager } from './tiles/models/tilesManager';
import { consumeAndPopulateFactory } from './requestConsumer';
import { PgBossJobQueueProvider } from './tiles/jobQueueProvider/pgBossJobQueue';
import { ConfigType, getConfig } from './common/config';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const cleanupRegistry = new CleanupRegistry();

  try {
    const configInstance = getConfig();

    const loggerConfig = configInstance.get('telemetry.logger');
    const logger = jsLogger({ ...loggerConfig, mixin: getOtelMixin() });

    cleanupRegistry.on('itemFailed', (id, error, msg) => logger.error({ msg, itemId: id, err: error }));
    cleanupRegistry.on('finished', (status) => logger.info({ msg: `cleanup registry finished cleanup`, status }));

    const pgBoss = pgBossFactory(configInstance.get('db'));
    cleanupRegistry.register({ func: pgBoss.stop.bind(pgBoss) });
    pgBoss.on('error', logger.error.bind(logger));
    await pgBoss.start();

    const tracer = trace.getTracer(SERVICE_NAME);
    const dependencies: InjectionObject<unknown>[] = [
      { token: SERVICES.CONFIG, provider: { useValue: configInstance } },
      { token: SERVICES.LOGGER, provider: { useValue: logger } },
      { token: SERVICES.TRACER, provider: { useValue: tracer } },
      {
        token: SERVICES.METRICS_REGISTRY,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const config = container.resolve<ConfigType>(SERVICES.CONFIG);
            const appConfig = config.get('app');

            if (config.get('telemetry.metrics.enabled')) {
              client.register.setDefaultLabels({
                project: appConfig.projectName,
                metatileSize: appConfig.metatileSize,
                handlingRequestQueue: appConfig.enableRequestQueueHandling,
              });
              return client.register;
            }
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
      {
        token: JOB_QUEUE_PROVIDER,
        provider: { useClass: PgBossJobQueueProvider },
        options: { lifecycle: Lifecycle.Singleton },
      },
      { token: CONSUME_AND_POPULATE_FACTORY, provider: { useFactory: consumeAndPopulateFactory } },
    ];

    return registerDependencies(dependencies, options?.override, options?.useChild);
  } catch (error) {
    await cleanupRegistry.trigger();
    throw error;
  }
};
