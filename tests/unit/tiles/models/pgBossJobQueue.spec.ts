import { setTimeout as setTimeoutPromise } from 'node:timers/promises';
import jsLogger from '@map-colonies/js-logger';
import PgBoss from 'pg-boss';
import { PgBossJobQueueProvider } from '../../../../src/tiles/jobQueueProvider/pgBossJobQueue';
import { IConfig } from '../../../../src/common/interfaces';

describe('PgBossJobQueueProvider', () => {
  let provider: PgBossJobQueueProvider;
  let configMock: IConfig;
  let pgbossMock: {
    on: jest.Mock;
    start: jest.Mock;
    stop: jest.Mock;
    getQueueSize: jest.Mock;
    complete: jest.Mock;
    fail: jest.Mock;
    fetch: jest.Mock;
  };

  beforeAll(() => {
    pgbossMock = {
      on: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      getQueueSize: jest.fn(),
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
              consumeDelay: 0.2,
            };
          default:
            break;
        }
      }),
      has: jest.fn(),
    };
  });

  beforeEach(function () {
    provider = new PgBossJobQueueProvider(pgbossMock as unknown as PgBoss, configMock, jsLogger({ enabled: false }));
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
      pgbossMock.fetch.mockResolvedValueOnce(job1).mockResolvedValueOnce(job2).mockResolvedValue(null);
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
      pgbossMock.fetch.mockResolvedValueOnce(job1).mockResolvedValueOnce(job2).mockResolvedValueOnce(job3).mockResolvedValueOnce(null);

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
      expect(pgbossMock.fail).toHaveBeenCalledWith(id, fetchError);
    });
  });
});
