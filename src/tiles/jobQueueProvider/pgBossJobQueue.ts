import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import { type Logger } from '@map-colonies/js-logger';
import PgBoss, { JobWithMetadata } from 'pg-boss';
import { inject, injectable } from 'tsyringe';
import { type ConfigType } from '@src/common/config';
import { MILLISECONDS_IN_SECOND, SERVICES } from '../../common/constants';
import { TILE_REQUEST_QUEUE_NAME_PREFIX } from '../models/constants';
import { type ConditionFn, JobQueueProvider } from './intefaces';
import { PGBOSS_PROVIDER } from './pgbossFactory';

@injectable()
export class PgBossJobQueueProvider implements JobQueueProvider {
  private isRunning = true;
  private readonly queueName: string;
  private readonly queueCheckTimeout: number;
  private readonly queueDelayTimeout: number;

  private runningJobs = 0;

  public constructor(
    @inject(PGBOSS_PROVIDER) private readonly pgBoss: PgBoss,
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    const appConfig = config.get('app');
    this.queueName = `${TILE_REQUEST_QUEUE_NAME_PREFIX}-${appConfig.projectName}`;
    this.queueCheckTimeout = appConfig.requestQueueCheckIntervalSec * MILLISECONDS_IN_SECOND;
    this.queueDelayTimeout = (appConfig.consumeCondition.delaySec ?? 0) * MILLISECONDS_IN_SECOND;
  }

  public get activeQueueName(): string {
    return this.queueName;
  }

  public startQueue(): void {
    this.logger.debug({ msg: 'starting queue', queueName: this.queueName });
    this.isRunning = true;
  }

  public stopQueue(): void {
    this.logger.debug({ msg: 'stopping queue', queueName: this.queueName });
    this.isRunning = false;
  }

  public async consumeQueue<T, R = void>(fn: (job: JobWithMetadata<T>) => Promise<R>, conditionFn?: ConditionFn): Promise<void> {
    this.logger.info({ msg: 'started consuming queue' });

    for await (const job of this.getJobsIterator<T>(conditionFn)) {
      if (!this.isRunning) {
        break;
      }

      this.runningJobs++;
      this.logger.debug({ msg: 'starting job', runningJobs: this.runningJobs });

      void this.handleJob(job, fn);
    }
  }

  private async handleJob<T, R = void>(job: JobWithMetadata<T>, fn: (value: JobWithMetadata<T>) => Promise<R>): Promise<void> {
    try {
      this.logger.debug({ msg: 'job fetched from queue', jobId: job.id });
      await fn(job);
      this.logger.debug({ msg: 'job completed successfully', jobId: job.id });
      await this.pgBoss.complete(job.id);
    } catch (err) {
      const error = err as Error;
      this.logger.error({ err: error, jobId: job.id, job });
      await this.pgBoss.fail(job.id, error);
    } finally {
      this.runningJobs--;
    }
  }

  private async *getJobsIterator<T>(conditionFn?: ConditionFn): AsyncGenerator<PgBoss.JobWithMetadata<T>> {
    while (this.isRunning) {
      const shouldFetch = conditionFn ? await conditionFn() : true;

      if (!shouldFetch) {
        this.logger.info({ msg: 'fetch condition is falsy, waiting for a while', timeout: this.queueDelayTimeout });
        await setTimeoutPromise(this.queueDelayTimeout);
        continue;
      }

      const jobs = await this.pgBoss.fetch<T>(this.queueName, 1, { includeMetadata: true });

      if (jobs === null || jobs.length === 0) {
        this.logger.info({ msg: 'queue is empty, waiting for data', queueName: this.queueName, timeout: this.queueCheckTimeout });
        await setTimeoutPromise(this.queueCheckTimeout);
        continue;
      }

      yield jobs[0];

      this.logger.info({ msg: 'next queue check after timeout', queueName: this.queueName, timeout: this.queueCheckTimeout });
      await setTimeoutPromise(this.queueCheckTimeout);
    }
  }
}
