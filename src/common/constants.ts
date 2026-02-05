import { readPackageJsonSync } from '@map-colonies/read-pkg';

export const SERVICE_NAME = readPackageJsonSync().name ?? 'unknown_service';
export const DEFAULT_SERVER_PORT = 80;

export const IGNORED_OUTGOING_TRACE_ROUTES = [/^.*\/v1\/metrics.*$/];
export const IGNORED_INCOMING_TRACE_ROUTES = [/^.*\/docs.*$/];

/* eslint-disable @typescript-eslint/naming-convention */
export const SERVICES = {
  LOGGER: Symbol('Logger'),
  CONFIG: Symbol('Config'),
  TRACER: Symbol('Tracer'),
  METRICS: Symbol('Metrics'),
  CLEANUP_REGISTRY: Symbol('CleanupRegistry'),
} satisfies Record<string, symbol>;
/* eslint-enable @typescript-eslint/naming-convention */

export const HEALTHCHECK = Symbol('healthcheck');
export const ON_SIGNAL = Symbol('onSignal');

export const CONSUME_AND_POPULATE_FACTORY = Symbol('consumeAndPopulateFactory');
export const JOB_QUEUE_PROVIDER = Symbol('JobQueueProvider');
export const QUEUE_NAMES = Symbol('QueueNames');

export const MILLISECONDS_IN_SECOND = 1000;
