import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import { jsLogger } from '@map-colonies/js-logger';
import { type PgBoss } from 'pg-boss';
import { ConfigType, initConfig } from '@src/common/config';
import { PgBossJobQueueProvider } from '../../../../src/tiles/jobQueueProvider/pgBossJobQueue';

describe('PgBossJobQueueProvider', () => {
  let provider: PgBossJobQueueProvider;
  let configMock: ConfigType;
  let pgbossMock: {
    on: jest.Mock;
    start: jest.Mock;
    stop: jest.Mock;
    getQueueStats: jest.Mock;
    complete: jest.Mock;
    fail: jest.Mock;
    fetch: jest.Mock;
  };

  beforeAll(async () => {
    await initConfig(true);
    pgbossMock = {
      on: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      getQueueStats: jest.fn(),
      complete: jest.fn(),
      fail: jest.fn(),
      fetch: jest.fn(),
    };

    configMock = {
      get: jest.fn().mockImplementation((key: string) => {
        switch (key) {
          case 'app':
            return {
              projectName: 'queue-name',
              requestQueueCheckIntervalSec: 0.1,
              consumeCondition: 0.2,
            };
          default:
            break;
        }
      }),
      getAll: jest.fn(),
      getConfigParts: jest.fn(),
      getResolvedOptions: jest.fn(),
      initializeMetrics: jest.fn(),
    };
  });

  beforeEach(async function () {
    provider = new PgBossJobQueueProvider(pgbossMock as unknown as PgBoss, configMock, await jsLogger({ enabled: false }));
  });

  afterEach(function () {
    jest.clearAllMocks();
  });

  describe('#activeQueueName', () => {
    it('should return the queue name', () => {
      expect(provider.activeQueueName).toBe('tiles-requests-queue-name');
    });
  });

  describe('#consumeQueue', () => {
    it('should consume the queue and call the provided funcs', async () => {
      const job1 = [{ id: 'id1', data: { key: 'value' } }];
      const job2 = [{ id: 'id2', data: { key: 'value' } }];

      const fnMock = jest.fn();
      pgbossMock.fetch.mockResolvedValueOnce(job1).mockResolvedValueOnce(job2).mockResolvedValue([]);
      provider.startQueue();
      const queuePromise = provider.consumeQueue(fnMock);
      await setTimeoutPromise(1000);
      provider.stopQueue();

      await expect(queuePromise).resolves.not.toThrow();

      expect(fnMock).toHaveBeenCalledTimes(2);
      expect(pgbossMock.complete).toHaveBeenCalledTimes(2);
      expect(pgbossMock.fail).not.toHaveBeenCalled();
    });

    it('should consume the queue depending on condition function result', async () => {
      const job1 = [{ id: 'id1', data: { key: 'value' } }];
      const job2 = [{ id: 'id2', data: { key: 'value' } }];
      const job3 = [{ id: 'id3', data: { key: 'value' } }];

      const fnMock = jest.fn();
      pgbossMock.fetch.mockResolvedValueOnce(job1).mockResolvedValueOnce(job2).mockResolvedValueOnce(job3).mockResolvedValueOnce([]);

      const conditionFnMock = jest.fn();
      conditionFnMock.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(false);

      provider.startQueue();
      const queuePromise = provider.consumeQueue(fnMock, conditionFnMock);

      await setTimeoutPromise(1000);
      provider.stopQueue();

      await expect(queuePromise).resolves.not.toThrow();

      expect(fnMock).toHaveBeenCalledTimes(2);
      expect(pgbossMock.complete).toHaveBeenCalledTimes(2);
      expect(pgbossMock.fail).not.toHaveBeenCalled();
    });

    it('should reject with an error if provided function for consuming has failed', async () => {
      const id = 'someId';
      pgbossMock.fetch.mockResolvedValueOnce([{ id }]);

      const fnMock = jest.fn();
      const fetchError = new Error('fetch error');
      fnMock.mockRejectedValue(fetchError);

      provider.startQueue();
      const queuePromise = provider.consumeQueue(fnMock);
      await setTimeoutPromise(1000);
      provider.stopQueue();
      await expect(queuePromise).resolves.not.toThrow();

      expect(pgbossMock.complete).not.toHaveBeenCalled();
      expect(pgbossMock.fail).toHaveBeenCalledWith('tiles-requests-queue-name', id, fetchError);
    });

    it('should skip fail() when pg-boss stops mid-job execution', async () => {
      const id = 'someId';
      pgbossMock.fetch.mockResolvedValueOnce([{ id, data: {} }]);

      provider.startQueue();
      const stoppedCallback = pgbossMock.on.mock.calls.find(([event]: [string, unknown]) => event === 'stopped')?.[1] as () => void;

      const fnMock = jest.fn().mockImplementation(async () => {
        stoppedCallback(); // fire stopped event mid-job, before throw
        throw new Error('job error');
      });

      const queuePromise = provider.consumeQueue(fnMock);
      await setTimeoutPromise(500);

      await expect(queuePromise).resolves.not.toThrow();
      expect(pgbossMock.fail).not.toHaveBeenCalled();
    });

    it('should swallow error when pgBoss.fail() itself throws', async () => {
      const id = 'someId';
      pgbossMock.fetch.mockResolvedValueOnce([{ id, data: {} }]).mockResolvedValue([]);
      pgbossMock.fail.mockRejectedValue(new Error('fail error'));

      const fnMock = jest.fn().mockRejectedValue(new Error('job error'));

      provider.startQueue();
      const queuePromise = provider.consumeQueue(fnMock);
      await setTimeoutPromise(500);
      provider.stopQueue();

      await expect(queuePromise).resolves.not.toThrow();
      expect(pgbossMock.fail).toHaveBeenCalledTimes(1);
    });

    it('should exit consumer loop gracefully when fetch throws during pg-boss shutdown', async () => {
      provider.startQueue();
      const stoppedCallback = pgbossMock.on.mock.calls.find(([event]: [string, unknown]) => event === 'stopped')?.[1] as () => void;

      pgbossMock.fetch.mockImplementation(async () => {
        stoppedCallback(); // stopped fires just before fetch throws
        throw new Error('pg-boss stopped');
      });

      const queuePromise = provider.consumeQueue(jest.fn());
      await setTimeoutPromise(200);

      await expect(queuePromise).resolves.not.toThrow();
    });

    it('should propagate fetch error when pg-boss is still running', async () => {
      pgbossMock.fetch.mockRejectedValue(new Error('unexpected fetch error'));

      provider.startQueue();
      const queuePromise = provider.consumeQueue(jest.fn());

      await expect(queuePromise).rejects.toThrow('unexpected fetch error');
    });
  });
});
