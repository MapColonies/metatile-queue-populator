import { getOtelMixin } from '@map-colonies/telemetry';
import { trace } from '@opentelemetry/api';
import { Registry } from 'prom-client';
import jsLogger, { Logger } from '@map-colonies/js-logger';
import { InjectionObject, registerDependencies } from '@common/dependencyRegistration';
import { CONSUME_AND_POPULATE_FACTORY, HEALTHCHECK, JOB_QUEUE_PROVIDER, ON_SIGNAL, SERVICES, SERVICE_NAME } from '@common/constants';
import { getTracing } from '@common/tracing';
import { ConfigType, getConfig } from '@common/config';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import { DependencyContainer, instanceCachingFactory, instancePerContainerCachingFactory, Lifecycle } from 'tsyringe';
import { type PgBoss } from 'pg-boss';
import { PGBOSS_PROVIDER, pgBossFactory } from './tiles/jobQueueProvider/pgbossFactory';
import { TILES_ROUTER_SYMBOL, tilesRouterFactory } from './tiles/routes/tilesRouter';
import { PgBossJobQueueProvider } from './tiles/jobQueueProvider/pgBossJobQueue';
import { TilesManager } from './tiles/models/tilesManager';
import { consumeAndPopulateFactory } from './requestConsumer';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export const registerExternalValues = async (options?: RegisterOptions): Promise<DependencyContainer> => {
  const cleanupRegistry = new CleanupRegistry();

  try {
    const dependencies: InjectionObject<unknown>[] = [
      { token: SERVICES.CONFIG, provider: { useValue: getConfig() } },
      {
        token: SERVICES.CLEANUP_REGISTRY,
        provider: { useValue: cleanupRegistry },
        afterAllInjectionHook(container): void {
          const logger = container.resolve<Logger>(SERVICES.LOGGER);
          const cleanupRegistryLogger = logger.child({ subComponent: 'cleanupRegistry' });

          cleanupRegistry.on('itemFailed', (id, error, msg) => cleanupRegistryLogger.error({ msg, itemId: id, err: error }));
          cleanupRegistry.on('itemCompleted', (id) => cleanupRegistryLogger.info({ itemId: id, msg: 'cleanup finished for item' }));
          cleanupRegistry.on('finished', (status) => cleanupRegistryLogger.info({ msg: `cleanup registry finished cleanup`, status }));
        },
      },
      {
        token: SERVICES.LOGGER,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const config = container.resolve<ConfigType>(SERVICES.CONFIG);
            const loggerConfig = config.get('telemetry.logger');
            const logger = jsLogger({ ...loggerConfig, mixin: getOtelMixin() });
            return logger;
          }),
        },
      },
      {
        token: SERVICES.TRACER,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
            cleanupRegistry.register({ id: SERVICES.TRACER, func: getTracing().stop.bind(getTracing()) });
            const tracer = trace.getTracer(SERVICE_NAME);
            return tracer;
          }),
        },
      },
      {
        token: SERVICES.METRICS,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const metricsRegistry = new Registry();
            const config = container.resolve<ConfigType>(SERVICES.CONFIG);
            config.initializeMetrics(metricsRegistry);
            return metricsRegistry;
          }),
        },
      },
      {
        token: TilesManager,
        provider: {
          useClass: TilesManager,
        },
        options: { lifecycle: Lifecycle.ContainerScoped },
      },
      {
        token: PGBOSS_PROVIDER,
        provider: {
          useFactory: instancePerContainerCachingFactory((container) => {
            const config = container.resolve<ConfigType>(SERVICES.CONFIG);
            const dbConfig = config.get('db');
            const pgBoss = pgBossFactory(dbConfig);

            const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
            cleanupRegistry.register({ func: pgBoss.stop.bind(pgBoss) });

            return pgBoss;
          }),
        },
        postInjectionHook: async (container): Promise<void> => {
          const pgBoss = container.resolve<PgBoss>(PGBOSS_PROVIDER);
          await pgBoss.start();

          const tilesManager = container.resolve(TilesManager);
          await pgBoss.createQueue(tilesManager.requestQueueName);
          await pgBoss.createQueue(tilesManager.tilesQueueName);
        },
      },
      { token: TILES_ROUTER_SYMBOL, provider: { useFactory: tilesRouterFactory } },
      {
        token: JOB_QUEUE_PROVIDER,
        provider: { useClass: PgBossJobQueueProvider },
        options: { lifecycle: Lifecycle.Singleton },
      },
      {
        token: HEALTHCHECK,
        provider: {
          useFactory: instanceCachingFactory((container) => {
            const tilesManager = container.resolve(TilesManager);
            return tilesManager.isAlive.bind(tilesManager);
          }),
        },
      },
      {
        token: ON_SIGNAL,
        provider: {
          useValue: cleanupRegistry.trigger.bind(cleanupRegistry),
        },
      },
      {
        token: CONSUME_AND_POPULATE_FACTORY,
        provider: { useFactory: consumeAndPopulateFactory },
      },
    ];

    const container = await registerDependencies(dependencies, options?.override, options?.useChild);
    return container;
  } catch (error) {
    await cleanupRegistry.trigger();
    throw error;
  }
};
