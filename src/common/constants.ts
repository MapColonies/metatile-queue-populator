import { readPackageJsonSync } from '@map-colonies/read-pkg';

export const SERVICE_NAME = readPackageJsonSync().name ?? 'unknown_service';
export const DEFAULT_SERVER_PORT = 8080;

export const IGNORED_OUTGOING_TRACE_ROUTES = [/^.*\/v1\/metrics.*$/];
export const IGNORED_INCOMING_TRACE_ROUTES = [/^.*\/docs.*$/, /^.*\/metrics.*/];

export const HEALTHCHECK_SYMBOL = Symbol('healthcheck');
export const ON_SIGNAL = Symbol('onSignal');
export const CONSUME_AND_POPULATE_FACTORY = Symbol('consumeAndPopulateFactory');
export const JOB_QUEUE_PROVIDER = Symbol('JobQueueProvider');

/* eslint-disable @typescript-eslint/naming-convention */
export const SERVICES: Record<string, symbol> = {
  LOGGER: Symbol('Logger'),
  CONFIG: Symbol('Config'),
  TRACER: Symbol('Tracer'),
  METER: Symbol('Meter'),
  METRICS_REGISTRY: Symbol('MetricsRegistry'),
  CLEANUP_REGISTRY: Symbol('CleanupRegistry'),
};
/* eslint-enable @typescript-eslint/naming-convention */

export const MILLISECONDS_IN_SECOND = 1000;
