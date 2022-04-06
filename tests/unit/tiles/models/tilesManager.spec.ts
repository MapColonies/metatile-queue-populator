import jsLogger from '@map-colonies/js-logger';
import { faker } from '@faker-js/faker';
import { Tile } from '@map-colonies/tile-calc';
import PgBoss from 'pg-boss';
import { IConfig } from '../../../../src/common/interfaces';
import { RequestAlreadyInQueueError } from '../../../../src/tiles/models/errors';
import { TileRequestQueuePayload } from '../../../../src/tiles/models/tiles';
import { TilesManager } from '../../../../src/tiles/models/tilesManager';

const logger = jsLogger({ enabled: false });

describe('tilesManager', () => {
  let configMock: jest.Mocked<IConfig>;
  beforeAll(() => {
    configMock = {
      get: jest.fn().mockImplementation((key: string) => {
        switch (key) {
          case 'app.projectName':
            return 'test';
          case 'app.tilesBatchSize':
            return 10;
          case 'app.metatileSize':
            return 8;
          default:
            break;
        }
      }),
      has: jest.fn(),
    };
  });

  describe('#addBboxTilesRequestToQueue', () => {
    it('resolve without error if everything is valid', async function () {
      const sendOnceMock = jest.fn().mockResolvedValue('ok');
      const tilesManager = new TilesManager({ sendOnce: sendOnceMock } as unknown as PgBoss, configMock, logger);

      const resource = tilesManager.addBboxTilesRequestToQueue({ east: 90, north: 90, south: -90, west: -90 }, 0, 0);

      await expect(resource).resolves.not.toThrow();
    });

    it('should throw RequestAlreadyInQueueError if the request is the same', async function () {
      const sendOnceMock = jest.fn().mockResolvedValue(null);
      const tilesManager = new TilesManager({ sendOnce: sendOnceMock } as unknown as PgBoss, configMock, logger);

      const resource = tilesManager.addBboxTilesRequestToQueue({ east: 90, north: 90, south: -90, west: -90 }, 0, 0);

      await expect(resource).rejects.toThrow(RequestAlreadyInQueueError);
    });

    it('should throw the error thrown by pg-boss', async function () {
      const sendOnceMock = jest.fn().mockRejectedValue(new Error('test'));
      const tilesManager = new TilesManager({ sendOnce: sendOnceMock } as unknown as PgBoss, configMock, logger);

      const resource = tilesManager.addBboxTilesRequestToQueue({ east: 90, north: 90, south: -90, west: -90 }, 0, 0);

      await expect(resource).rejects.toThrow('test');
    });
  });

  describe('#isAlive', () => {
    it('should resolve without error', async function () {
      const getQueueSizeMock = jest.fn().mockResolvedValue(0);
      const tilesManager = new TilesManager({ getQueueSize: getQueueSizeMock } as unknown as PgBoss, configMock, logger);

      const resource = tilesManager.isAlive();

      await expect(resource).resolves.not.toThrow();
    });

    it('should throw the error thrown by pg-boss', async function () {
      const getQueueSizeMock = jest.fn().mockRejectedValue(new Error('test'));
      const tilesManager = new TilesManager({ getQueueSize: getQueueSizeMock } as unknown as PgBoss, configMock, logger);

      const isAlivePromise = tilesManager.isAlive();

      await expect(isAlivePromise).rejects.toThrow('test');
    });
  });

  describe('#addTilesToQueue', () => {
    it('should insert the tiles into the queue', async function () {
      const insertMock = jest.fn<Promise<string>, [PgBoss.JobInsert<Tile>[]]>().mockResolvedValue('ok');
      const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger);

      const promise = tilesManager.addTilesToQueue([
        { x: 9794, y: 2650, z: 16, metatile: 8 },
        { x: 39176, y: 10600, z: 18, metatile: 8 },
        { x: 19588, y: 5300, z: 17, metatile: 8 },
      ]) as unknown as PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>;

      await expect(promise).resolves.not.toThrow();
      expect(insertMock).toHaveBeenCalledTimes(1);

      const args = insertMock.mock.calls[0][0];
      expect(args.map((job) => job.data)).toContainSameTiles([
        { x: 9794, y: 2650, z: 16, metatile: 8 },
        { x: 39176, y: 10600, z: 18, metatile: 8 },
        { x: 19588, y: 5300, z: 17, metatile: 8 },
      ]);
    });

    it('should add the same parent id to all the tiles added', async function () {
      const insertMock = jest.fn<Promise<string>, [PgBoss.JobInsert<Tile & { parent: string }>[]]>().mockResolvedValue('ok');
      const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger);

      const promise = tilesManager.addTilesToQueue([
        { x: 9794, y: 2650, z: 16, metatile: 8 },
        { x: 39176, y: 10600, z: 18, metatile: 8 },
      ]) as unknown as PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>;

      await expect(promise).resolves.not.toThrow();
      expect(insertMock).toHaveBeenCalledTimes(1);

      const args = insertMock.mock.calls[0][0];

      expect(args[0].data?.parent).toBeDefined();
      expect(args[0].data?.parent).toBe(args[1].data?.parent);
    });
  });

  describe('#handleTileRequest', () => {
    describe('api requests', () => {
      it('should insert the tile to the queue', async function () {
        const insertMock = jest.fn<Promise<string>, [PgBoss.JobInsert]>().mockResolvedValue('ok');
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger);

        const promise = tilesManager.handleTileRequest({
          data: {
            bbox: [{ west: 35.20076259970665, south: 31.770502933414285, east: 35.20134598016739, north: 31.77073210500818 }],
            maxZoom: 18,
            minZoom: 18,
            source: 'api',
          },
        } as unknown as PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const args = insertMock.mock.calls[0][0];
        expect(args).toEqual([
          {
            name: 'tiles-test',
            data: { x: 39176, y: 10600, z: 18, metatile: 8 },
          },
        ]);
      });

      it('should insert tiles in multiple zoom levels', async function () {
        const insertMock = jest.fn<Promise<string>, [PgBoss.JobInsert<Tile>[]]>().mockResolvedValue('ok');
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger);

        const promise = tilesManager.handleTileRequest({
          data: {
            bbox: [{ west: 35.20076259970665, south: 31.770502933414285, east: 35.20134598016739, north: 31.77073210500818 }],
            maxZoom: 18,
            minZoom: 16,
            source: 'api',
          },
        } as unknown as PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const args = insertMock.mock.calls[0][0];
        expect(args.map((job) => job.data)).toContainSameTiles([
          { x: 9794, y: 2650, z: 16, metatile: 8 },
          { x: 39176, y: 10600, z: 18, metatile: 8 },
          { x: 19588, y: 5300, z: 17, metatile: 8 },
        ]);
      });

      it('should should insert tiles into the queue in multiple batches', async function () {
        const insertMock = jest.fn<Promise<string>, [PgBoss.JobInsert<Tile>[]]>().mockResolvedValue('ok');
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger);

        const promise = tilesManager.handleTileRequest({
          data: {
            bbox: [{ west: 35.20076259970665, south: 31.770502933414285, east: 35.21034598016739, north: 31.80173210500818 }],
            maxZoom: 18,
            minZoom: 18,
            source: 'api',
          },
        } as unknown as PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(2);

        const firstCallArgs = insertMock.mock.calls[0][0];
        const secondCallArgs = insertMock.mock.calls[1][0];
        expect(firstCallArgs).toHaveLength(10);

        expect([...firstCallArgs, ...secondCallArgs].map((job) => job.data)).toContainSameTiles([
          { x: 39177, y: 10594, z: 18, metatile: 8 },
          { x: 39176, y: 10594, z: 18, metatile: 8 },
          { x: 39176, y: 10595, z: 18, metatile: 8 },
          { x: 39176, y: 10596, z: 18, metatile: 8 },
          { x: 39177, y: 10595, z: 18, metatile: 8 },
          { x: 39177, y: 10596, z: 18, metatile: 8 },
          { x: 39177, y: 10597, z: 18, metatile: 8 },
          { x: 39176, y: 10597, z: 18, metatile: 8 },
          { x: 39176, y: 10598, z: 18, metatile: 8 },
          { x: 39176, y: 10599, z: 18, metatile: 8 },
          { x: 39177, y: 10598, z: 18, metatile: 8 },
          { x: 39177, y: 10599, z: 18, metatile: 8 },
          { x: 39177, y: 10600, z: 18, metatile: 8 },
          { x: 39176, y: 10600, z: 18, metatile: 8 },
        ]);
      });

      it('should add the id of the parent tile request to the tiles', async function () {
        const insertMock = jest.fn<Promise<string>, [PgBoss.JobInsert]>().mockResolvedValue('ok');
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger);
        const id = faker.datatype.uuid();

        const promise = tilesManager.handleTileRequest({
          data: {
            bbox: [{ west: 35.20076259970665, south: 31.770502933414285, east: 35.20134598016739, north: 31.77073210500818 }],
            maxZoom: 18,
            minZoom: 18,
            source: 'api',
          },
          id,
        } as unknown as PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const args = insertMock.mock.calls[0][0];
        expect(args).toEqual([
          {
            name: 'tiles-test',
            data: { x: 39176, y: 10600, z: 18, metatile: 8, parent: id },
          },
        ]);
      });
    });

    describe('expired tiles requests', () => {
      it('should insert the tile to the queue', async function () {
        const insertMock = jest.fn<Promise<string>, [PgBoss.JobInsert]>().mockResolvedValue('ok');
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger);

        const promise = tilesManager.handleTileRequest({
          data: {
            bbox: [{ west: 35.20076259970665, south: 31.770502933414285, east: 35.20134598016739, north: 31.77073210500818 }],
            maxZoom: 18,
            minZoom: 18,
            source: 'expiredTiles',
          },
        } as unknown as PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const args = insertMock.mock.calls[0][0];
        expect(args).toEqual([
          {
            name: 'tiles-test',
            data: { x: 39176, y: 10600, z: 18, metatile: 8 },
          },
        ]);
      });

      it('should insert tiles in multiple zoom levels', async function () {
        const insertMock = jest.fn<Promise<string>, [PgBoss.JobInsert<Tile>[]]>().mockResolvedValue('ok');
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger);

        const promise = tilesManager.handleTileRequest({
          data: {
            bbox: [{ west: 35.20076259970665, south: 31.770502933414285, east: 35.20134598016739, north: 31.77073210500818 }],
            maxZoom: 18,
            minZoom: 16,
            source: 'expiredTiles',
          },
        } as unknown as PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const args = insertMock.mock.calls[0][0];
        expect(args.map((job) => job.data)).toContainSameTiles([
          { x: 9794, y: 2650, z: 16, metatile: 8 },
          { x: 39176, y: 10600, z: 18, metatile: 8 },
          { x: 19588, y: 5300, z: 17, metatile: 8 },
        ]);
      });

      it('should should insert tiles into the queue in multiple batches', async function () {
        const insertMock = jest.fn<Promise<string>, [PgBoss.JobInsert<Tile>[]]>().mockResolvedValue('ok');
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger);

        const promise = tilesManager.handleTileRequest({
          data: {
            bbox: [{ west: 35.20076259970665, south: 31.770502933414285, east: 35.21034598016739, north: 31.80173210500818 }],
            maxZoom: 18,
            minZoom: 18,
            source: 'expiredTiles',
          },
        } as unknown as PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(2);

        const firstCallArgs = insertMock.mock.calls[0][0];
        const secondCallArgs = insertMock.mock.calls[1][0];
        expect(firstCallArgs).toHaveLength(10);

        expect([...firstCallArgs, ...secondCallArgs].map((job) => job.data)).toContainSameTiles([
          { x: 39177, y: 10594, z: 18, metatile: 8 },
          { x: 39176, y: 10594, z: 18, metatile: 8 },
          { x: 39176, y: 10595, z: 18, metatile: 8 },
          { x: 39176, y: 10596, z: 18, metatile: 8 },
          { x: 39177, y: 10595, z: 18, metatile: 8 },
          { x: 39177, y: 10596, z: 18, metatile: 8 },
          { x: 39177, y: 10597, z: 18, metatile: 8 },
          { x: 39176, y: 10597, z: 18, metatile: 8 },
          { x: 39176, y: 10598, z: 18, metatile: 8 },
          { x: 39176, y: 10599, z: 18, metatile: 8 },
          { x: 39177, y: 10598, z: 18, metatile: 8 },
          { x: 39177, y: 10599, z: 18, metatile: 8 },
          { x: 39177, y: 10600, z: 18, metatile: 8 },
          { x: 39176, y: 10600, z: 18, metatile: 8 },
        ]);
      });

      it('should not insert the same tile twice', async function () {
        const insertMock = jest.fn<Promise<string>, [PgBoss.JobInsert]>().mockResolvedValue('ok');
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger);

        const promise = tilesManager.handleTileRequest({
          data: {
            bbox: [
              { west: 35.20076259970665, south: 31.770502933414285, east: 35.20134598016739, north: 31.77073210500818 },
              { west: 35.20076259970665, south: 31.770502933414285, east: 35.20134598016739, north: 31.77073210500818 },
            ],
            maxZoom: 18,
            minZoom: 18,
            source: 'expiredTiles',
          },
        } as unknown as PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const args = insertMock.mock.calls[0][0];
        expect(args).toEqual([
          {
            name: 'tiles-test',
            data: { x: 39176, y: 10600, z: 18, metatile: 8 },
          },
        ]);
      });

      it('should add the id of the tile request to the tiles', async function () {
        const insertMock = jest.fn<Promise<string>, [PgBoss.JobInsert]>().mockResolvedValue('ok');
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger);
        const id = faker.datatype.uuid();

        const promise = tilesManager.handleTileRequest({
          data: {
            bbox: [{ west: 35.20076259970665, south: 31.770502933414285, east: 35.20134598016739, north: 31.77073210500818 }],
            maxZoom: 18,
            minZoom: 18,
            source: 'expiredTiles',
          },
          id,
        } as unknown as PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const args = insertMock.mock.calls[0][0];
        expect(args).toEqual([
          {
            name: 'tiles-test',
            data: { x: 39176, y: 10600, z: 18, metatile: 8, parent: id },
          },
        ]);
      });
    });
  });
});
