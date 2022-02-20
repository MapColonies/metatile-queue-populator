import jsLogger from '@map-colonies/js-logger';
import PgBoss from 'pg-boss';
import { RequestAlreadyInQueueError } from '../../../../src/tiles/models/errors';
import { TilesManager } from '../../../../src/tiles/models/tilesManager';

describe('tilesManager', () => {
  describe('#addTilesRequestToQueue', () => {
    it('resolve without error if everything is valid', async function () {
      const sendOnceMock = jest.fn().mockResolvedValue('ok');
      const tilesManager = new TilesManager({ sendOnce: sendOnceMock } as unknown as PgBoss, 'test');

      // action
      const resource = tilesManager.addTilesRequestToQueue({ east: 90, north: 90, south: -90, west: -90 }, 0, 0);

      // expectation
      await expect(resource).resolves.not.toThrow();
    });

    it('should throw RequestAlreadyInQueueError if the request is the same', async function () {
      const sendOnceMock = jest.fn().mockResolvedValue(null);
      const tilesManager = new TilesManager({ sendOnce: sendOnceMock } as unknown as PgBoss, 'test');

      // action
      const resource = tilesManager.addTilesRequestToQueue({ east: 90, north: 90, south: -90, west: -90 }, 0, 0);

      // expectation
      await expect(resource).rejects.toThrow(RequestAlreadyInQueueError);
    });

    it('should throw the error thrown by pg-boss', async function () {
      const sendOnceMock = jest.fn().mockRejectedValue(new Error('test'));
      const tilesManager = new TilesManager({ sendOnce: sendOnceMock } as unknown as PgBoss, 'test');

      // action
      const resource = tilesManager.addTilesRequestToQueue({ east: 90, north: 90, south: -90, west: -90 }, 0, 0);

      // expectation
      await expect(resource).rejects.toThrow('test');
    });
  });
});
