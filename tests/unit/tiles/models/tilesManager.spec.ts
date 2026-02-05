import jsLogger from '@map-colonies/js-logger';
import { faker } from '@faker-js/faker';
import { Tile } from '@map-colonies/tile-calc';
import { type JobInsert, type JobWithMetadata, type PgBoss } from 'pg-boss';
import client from 'prom-client';
import { bbox } from '@turf/turf';
import { FeatureCollection } from 'geojson';
import { API_STATE } from '@map-colonies/detiler-common';
import { ConfigType, getConfig } from '@src/common/config';
import { queueNames } from '@tests/helpers/constants';
import { RequestAlreadyInQueueError } from '../../../../src/tiles/models/errors';
import { TileRequestQueuePayload, TilesByAreaRequest } from '../../../../src/tiles/models/tiles';
import { TilesManager } from '../../../../src/tiles/models/tilesManager';
import { BBOX1, BBOX2, GOOD_FEATURE, GOOD_LARGE_FEATURE } from '../../../helpers/samples';
import { boundingBoxToPolygon } from '../../../../src/tiles/models/util';
import { hashValue } from '../../../../src/common/util';

const logger = jsLogger({ enabled: false });
const queueConfig = { retryDelay: 1, expireInSeconds: 60 };

describe('tilesManager', () => {
  let config: ConfigType;
  let configMock: jest.Mocked<ConfigType>;

  beforeAll(() => {
    config = getConfig();
  });

  beforeEach(() => {
    configMock = {
      get: jest.fn().mockImplementation((key: string) => {
        switch (key) {
          case 'app':
            return {
              projectName: 'test',
              tilesBatchSize: 10,
              metatileSize: 8,
              force: {
                api: false,
                expiredTiles: false,
              },
            };
          case 'telemetry.metrics.buckets':
            return [];
          case 'queue': {
            const { retryDelay } = queueConfig;
            return { retryDelaySeconds: retryDelay, ...queueConfig };
          }
          default:
            return config.get(key);
        }
      }),
      getAll: jest.fn(),
      getConfigParts: jest.fn(),
      getResolvedOptions: jest.fn(),
      initializeMetrics: jest.fn(),
    };
  });

  describe('#addBboxTilesRequestToQueue', () => {
    it('resolve without error if request is a valid bbox', async function () {
      const sendMock = jest.fn().mockResolvedValue('ok');
      const tilesManager = new TilesManager({ send: sendMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());
      const request: TilesByAreaRequest[] = [{ area: [90, 90, -90, -90], minZoom: 0, maxZoom: 0 }];
      const expectedPayload: TileRequestQueuePayload = {
        items: [{ area: { west: 90, south: 90, east: -90, north: -90 }, minZoom: 0, maxZoom: 0 }],
        source: 'api',
        state: API_STATE,
      };

      const resource = tilesManager.addArealTilesRequestToQueue(request);

      await expect(resource).resolves.not.toThrow();
      expect(sendMock).toHaveBeenCalledWith('tiles-requests-test', expectedPayload, {
        ...queueConfig,
        singletonKey: hashValue(expectedPayload),
        singletonSeconds: queueConfig.expireInSeconds,
      });
    });

    it('resolve without error if request is a valid geojson', async function () {
      const sendMock = jest.fn().mockResolvedValue('ok');
      const tilesManager = new TilesManager({ send: sendMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());
      const request: TilesByAreaRequest[] = [{ area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 }];
      const expectedPayload: TileRequestQueuePayload = { items: [{ area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 }], source: 'api', state: API_STATE };

      const resource = tilesManager.addArealTilesRequestToQueue(request);

      await expect(resource).resolves.not.toThrow();
      expect(sendMock).toHaveBeenCalledWith('tiles-requests-test', expectedPayload, {
        ...queueConfig,
        singletonKey: hashValue(expectedPayload),
        singletonSeconds: queueConfig.expireInSeconds,
      });
    });

    it('resolve without error if request is a mix of valid bbox and geojson', async function () {
      const sendMock = jest.fn().mockResolvedValue('ok');
      const tilesManager = new TilesManager({ send: sendMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());
      const request: TilesByAreaRequest[] = [
        { area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 },
        { area: [90, 90, -90, -90], minZoom: 0, maxZoom: 0 },
      ];
      const expectedPayload: TileRequestQueuePayload = {
        items: [
          { area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 },
          { area: { west: 90, south: 90, east: -90, north: -90 }, minZoom: 0, maxZoom: 0 },
        ],
        source: 'api',
        state: API_STATE,
      };

      const resource = tilesManager.addArealTilesRequestToQueue(request);

      await expect(resource).resolves.not.toThrow();
      expect(sendMock).toHaveBeenCalledWith('tiles-requests-test', expectedPayload, {
        ...queueConfig,
        singletonKey: hashValue(expectedPayload),
        singletonSeconds: queueConfig.expireInSeconds,
      });
    });

    it('resolve without error if request is a mix of valid bbox and feature geojson, bbox and featureCollection geojson', async function () {
      const sendMock = jest.fn().mockResolvedValue('ok');
      const tilesManager = new TilesManager({ send: sendMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());
      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [GOOD_FEATURE, GOOD_FEATURE],
      };
      const request: TilesByAreaRequest[] = [
        { area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 },
        { area: [90, 90, -90, -90], minZoom: 0, maxZoom: 0 },
        { area: featureCollection, minZoom: 0, maxZoom: 0 },
      ];
      const expectedPayload: TileRequestQueuePayload = {
        items: [
          { area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 },
          { area: { west: 90, south: 90, east: -90, north: -90 }, minZoom: 0, maxZoom: 0 },
          { area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 },
          { area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 },
        ],
        source: 'api',
        state: API_STATE,
      };

      const resource = tilesManager.addArealTilesRequestToQueue(request);

      await expect(resource).resolves.not.toThrow();
      expect(sendMock).toHaveBeenCalledWith('tiles-requests-test', expectedPayload, {
        ...queueConfig,
        singletonKey: hashValue(expectedPayload),
        singletonSeconds: queueConfig.expireInSeconds,
      });
    });

    it('resolve without error if request is a mix with force attibute', async function () {
      const sendMock = jest.fn().mockResolvedValue('ok');
      const tilesManager = new TilesManager({ send: sendMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());
      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [GOOD_FEATURE, GOOD_FEATURE],
      };
      const request: TilesByAreaRequest[] = [
        { area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 },
        { area: [90, 90, -90, -90], minZoom: 0, maxZoom: 0 },
        { area: featureCollection, minZoom: 0, maxZoom: 0 },
      ];
      const expectedPayload: TileRequestQueuePayload = {
        items: [
          { area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 },
          { area: { west: 90, south: 90, east: -90, north: -90 }, minZoom: 0, maxZoom: 0 },
          { area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 },
          { area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 },
        ],
        source: 'api',
        state: API_STATE,
        force: true,
      };

      const resource = tilesManager.addArealTilesRequestToQueue(request, true);

      await expect(resource).resolves.not.toThrow();
      expect(sendMock).toHaveBeenCalledWith('tiles-requests-test', expectedPayload, {
        ...queueConfig,
        singletonKey: hashValue(expectedPayload),
        singletonSeconds: queueConfig.expireInSeconds,
      });
    });

    it('resolve without error if request is a mix with force attribute if app is configured so', async function () {
      configMock = {
        ...configMock,
        get: jest.fn().mockImplementation((key: string) => {
          switch (key) {
            case 'app':
              return {
                projectName: 'test',
                tilesBatchSize: 10,
                metatileSize: 8,
                force: { api: true },
              };
            case 'telemetry.metrics.buckets':
              return [];
            case 'queue': {
              const { retryDelay } = queueConfig;
              return { retryDelaySeconds: retryDelay, ...queueConfig };
            }
            default:
              break;
          }
        }),
      };

      const sendMock = jest.fn().mockResolvedValue('ok');
      const tilesManager = new TilesManager({ send: sendMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());
      const featureCollection: FeatureCollection = {
        type: 'FeatureCollection',
        features: [GOOD_FEATURE, GOOD_FEATURE],
      };
      const request: TilesByAreaRequest[] = [
        { area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 },
        { area: [90, 90, -90, -90], minZoom: 0, maxZoom: 0 },
        { area: featureCollection, minZoom: 0, maxZoom: 0 },
      ];
      const expectedPayload: TileRequestQueuePayload = {
        items: [
          { area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 },
          { area: { west: 90, south: 90, east: -90, north: -90 }, minZoom: 0, maxZoom: 0 },
          { area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 },
          { area: GOOD_FEATURE, minZoom: 0, maxZoom: 0 },
        ],
        source: 'api',
        state: API_STATE,
        force: true,
      };

      const resource = tilesManager.addArealTilesRequestToQueue(request);

      await expect(resource).resolves.not.toThrow();
      expect(sendMock).toHaveBeenCalledWith('tiles-requests-test', expectedPayload, {
        ...queueConfig,
        singletonKey: hashValue(expectedPayload),
        singletonSeconds: queueConfig.expireInSeconds,
      });
    });

    it('should throw RequestAlreadyInQueueError if the request is the same', async function () {
      const sendMock = jest.fn().mockResolvedValue(null);
      const tilesManager = new TilesManager({ send: sendMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());
      const request: TilesByAreaRequest[] = [{ area: [90, 90, -90, -90], minZoom: 0, maxZoom: 0 }];

      const resource = tilesManager.addArealTilesRequestToQueue(request);

      await expect(resource).rejects.toThrow(RequestAlreadyInQueueError);
    });

    it('should throw the error thrown by pg-boss', async function () {
      const sendMock = jest.fn().mockRejectedValue(new Error('test'));
      const tilesManager = new TilesManager({ send: sendMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());
      const request: TilesByAreaRequest[] = [{ area: [90, 90, -90, -90], minZoom: 0, maxZoom: 0 }];

      const resource = tilesManager.addArealTilesRequestToQueue(request);

      await expect(resource).rejects.toThrow('test');
    });
  });

  describe('#isAlive', () => {
    it('should resolve without error', async function () {
      const getQueueStatsMock = jest.fn().mockResolvedValue({ totalCount: 0 });
      const tilesManager = new TilesManager(
        { getQueueStats: getQueueStatsMock } as unknown as PgBoss,
        configMock,
        logger,
        queueNames,
        new client.Registry()
      );

      const resource = tilesManager.isAlive();

      await expect(resource).resolves.not.toThrow();
    });

    it('should throw the error thrown by pg-boss', async function () {
      const getQueueStatsMock = jest.fn().mockRejectedValue(new Error('test'));
      const tilesManager = new TilesManager(
        { getQueueStats: getQueueStatsMock } as unknown as PgBoss,
        configMock,
        logger,
        queueNames,
        new client.Registry()
      );

      const isAlivePromise = tilesManager.isAlive();

      await expect(isAlivePromise).rejects.toThrow('test');
    });
  });

  describe('#addTilesToQueue', () => {
    it('should insert the tiles into the queue', async function () {
      const insertMock = jest.fn().mockResolvedValue(['ok']);
      const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

      const promise = tilesManager.addTilesToQueue([
        { x: 9794, y: 2650, z: 16, metatile: 8 },
        { x: 39176, y: 10600, z: 18, metatile: 8 },
        { x: 19588, y: 5300, z: 17, metatile: 8 },
      ]);

      await expect(promise).resolves.not.toThrow();
      expect(insertMock).toHaveBeenCalledTimes(1);

      const args = insertMock.mock.calls[0][1] as JobInsert<Tile>[];
      expect(args.map((job) => job.data)).toContainSameTiles([
        { x: 9794, y: 2650, z: 16, metatile: 8 },
        { x: 39176, y: 10600, z: 18, metatile: 8 },
        { x: 19588, y: 5300, z: 17, metatile: 8 },
      ]);
    });

    it('should insert the tiles into the queue with force attribute if requst is configured so', async function () {
      const insertMock = jest.fn().mockResolvedValue(['ok']);
      const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

      const promise = tilesManager.addTilesToQueue(
        [
          { x: 9794, y: 2650, z: 16, metatile: 8 },
          { x: 39176, y: 10600, z: 18, metatile: 8 },
          { x: 19588, y: 5300, z: 17, metatile: 8 },
        ],
        true
      );

      await expect(promise).resolves.not.toThrow();
      expect(insertMock).toHaveBeenCalledTimes(1);

      const args = insertMock.mock.calls[0][1] as JobInsert<Tile>[];
      expect(args.map((job) => job.data)).toContainSameTiles([
        { x: 9794, y: 2650, z: 16, metatile: 8, force: true },
        { x: 39176, y: 10600, z: 18, metatile: 8, force: true },
        { x: 19588, y: 5300, z: 17, metatile: 8, force: true },
      ]);
    });

    it('should insert the tiles into the queue with force attribute if app is configured so', async function () {
      configMock = {
        ...configMock,
        get: jest.fn().mockImplementation((key: string) => {
          switch (key) {
            case 'app':
              return {
                projectName: 'test',
                tilesBatchSize: 10,
                metatileSize: 8,
                force: { api: true },
              };
            case 'telemetry.metrics.buckets':
              return [];
            case 'queue': {
              const { retryDelay } = queueConfig;
              return { retryDelaySeconds: retryDelay, ...queueConfig };
            }
            default:
              break;
          }
        }),
      };

      const insertMock = jest.fn().mockResolvedValue(['ok']);
      const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

      const promise = tilesManager.addTilesToQueue([
        { x: 9794, y: 2650, z: 16, metatile: 8 },
        { x: 39176, y: 10600, z: 18, metatile: 8 },
        { x: 19588, y: 5300, z: 17, metatile: 8 },
      ]);

      await expect(promise).resolves.not.toThrow();
      expect(insertMock).toHaveBeenCalledTimes(1);

      const args = insertMock.mock.calls[0][1] as JobInsert<Tile>[];
      expect(args.map((job) => job.data)).toContainSameTiles([
        { x: 9794, y: 2650, z: 16, metatile: 8, force: true },
        { x: 39176, y: 10600, z: 18, metatile: 8, force: true },
        { x: 19588, y: 5300, z: 17, metatile: 8, force: true },
      ]);
    });

    it('should add the same parent id to all the tiles added', async function () {
      const insertMock = jest.fn().mockResolvedValue(['ok']);
      const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

      const promise = tilesManager.addTilesToQueue([
        { x: 9794, y: 2650, z: 16, metatile: 8 },
        { x: 39176, y: 10600, z: 18, metatile: 8 },
      ]);

      await expect(promise).resolves.not.toThrow();
      expect(insertMock).toHaveBeenCalledTimes(1);

      const args = insertMock.mock.calls[0][1] as JobInsert<Tile & { parent: string }>[];

      expect(args[0].data?.parent).toBeDefined();
      expect(args[0].data?.parent).toBe(args[1].data?.parent);
    });
  });

  describe('#handleTileRequest', () => {
    describe('api requests', () => {
      it('should insert the tile generated by a bbox request to the queue', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

        const promise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: BBOX1,
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'api',
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const queueName = insertMock.mock.calls[0][0];
        const args = insertMock.mock.calls[0][1] as JobInsert[];
        expect(queueName).toBe('tiles-test');
        expect(args).toEqual([
          {
            ...queueConfig,
            data: { x: 39176, y: 10600, z: 18, metatile: 8, parent: undefined, state: undefined, force: undefined },
          },
        ]);
      });

      it('should insert the tile generated by a bbox request to the queue with force attribute if request is configured so', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

        const promise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: BBOX1,
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'api',
            force: true,
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const queueName = insertMock.mock.calls[0][0];
        const args = insertMock.mock.calls[0][1] as JobInsert[];
        expect(queueName).toBe('tiles-test');
        expect(args).toEqual([
          {
            ...queueConfig,
            data: { x: 39176, y: 10600, z: 18, metatile: 8, force: true, parent: undefined, state: undefined },
          },
        ]);
      });

      it('should insert the tile generated by a bbox request to the queue with force attribute if app is configured so', async function () {
        configMock = {
          ...configMock,
          get: jest.fn().mockImplementation((key: string) => {
            switch (key) {
              case 'app':
                return {
                  projectName: 'test',
                  tilesBatchSize: 10,
                  metatileSize: 8,
                  force: { api: true },
                };
              case 'telemetry.metrics.buckets':
                return [];
              case 'queue': {
                const { retryDelay } = queueConfig;
                return { retryDelaySeconds: retryDelay, ...queueConfig };
              }
              default:
                break;
            }
          }),
        };

        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

        const promise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: BBOX1,
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'api',
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const queueName = insertMock.mock.calls[0][0];
        const args = insertMock.mock.calls[0][1] as JobInsert[];
        expect(queueName).toBe('tiles-test');
        expect(args).toEqual([
          {
            ...queueConfig,
            data: { x: 39176, y: 10600, z: 18, metatile: 8, force: true, parent: undefined, state: undefined },
          },
        ]);
      });

      it('should insert the tile generated by bbox and geojson request to the queue', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

        const promise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: BBOX1,
                minZoom: 18,
                maxZoom: 18,
              },
              {
                area: boundingBoxToPolygon(BBOX2),
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'api',
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(2);

        const firstCallArgs = insertMock.mock.calls[0][1] as JobInsert[];
        const secondCallArgs = insertMock.mock.calls[1][1] as JobInsert[];

        expect(firstCallArgs).toHaveLength(10);
        expect(secondCallArgs).toHaveLength(5);
        expect([...firstCallArgs, ...secondCallArgs].map((job) => job.data)).toContainSameTiles([
          { x: 39176, y: 10600, z: 18, metatile: 8 },
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

      it('should insert the tile generated by a geojson request to the queue', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

        const promise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: boundingBoxToPolygon(BBOX1),
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'api',
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const queueName = insertMock.mock.calls[0][0];
        const args = insertMock.mock.calls[0][1] as JobInsert[];
        expect(queueName).toBe('tiles-test');
        expect(args).toEqual([
          {
            ...queueConfig,
            data: { x: 39176, y: 10600, z: 18, metatile: 8, parent: undefined, state: undefined, force: undefined },
          },
        ]);
      });

      it('should insert tiles generated by bbox request in multiple zoom levels', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

        const promise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: BBOX1,
                minZoom: 16,
                maxZoom: 18,
              },
            ],
            source: 'api',
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const args = insertMock.mock.calls[0][1] as JobInsert<Tile>[];
        expect(args.map((job) => job.data)).toContainSameTiles([
          { x: 9794, y: 2650, z: 16, metatile: 8 },
          { x: 39176, y: 10600, z: 18, metatile: 8 },
          { x: 19588, y: 5300, z: 17, metatile: 8 },
        ]);
      });

      it('should insert tiles generated by geojson request in multiple zoom levels', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

        const promise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: boundingBoxToPolygon(BBOX1),
                minZoom: 16,
                maxZoom: 18,
              },
            ],
            source: 'api',
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const args = insertMock.mock.calls[0][1] as JobInsert<Tile>[];
        expect(args.map((job) => job.data)).toContainSameTiles([
          { x: 9794, y: 2650, z: 16, metatile: 8 },
          { x: 39176, y: 10600, z: 18, metatile: 8 },
          { x: 19588, y: 5300, z: 17, metatile: 8 },
        ]);
      });

      it('should insert tiles generated by bbox into the queue in multiple batches', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

        const promise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: BBOX2,
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'api',
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(2);

        const firstCallArgs = insertMock.mock.calls[0][1] as JobInsert[];
        const secondCallArgs = insertMock.mock.calls[1][1] as JobInsert[];
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

      it('should insert tiles generated by geojson into the queue in multiple batches', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

        const promise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: boundingBoxToPolygon(BBOX2),
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'api',
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(2);

        const firstCallArgs = insertMock.mock.calls[0][1] as JobInsert[];
        const secondCallArgs = insertMock.mock.calls[1][1] as JobInsert[];
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

      it('should add the id of the parent tile request to the tiles generated by bbox request', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());
        const id = faker.string.uuid();

        const promise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: BBOX1,
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'api',
          },
          id,
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const queueName = insertMock.mock.calls[0][0];
        const args = insertMock.mock.calls[0][1] as JobInsert[];
        expect(queueName).toBe('tiles-test');
        expect(args).toEqual([
          {
            ...queueConfig,
            data: { x: 39176, y: 10600, z: 18, metatile: 8, parent: id, state: undefined, force: undefined },
          },
        ]);
      });

      it('should add the id of the parent tile request to the tiles generated by geojson request', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());
        const id = faker.string.uuid();

        const promise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: boundingBoxToPolygon(BBOX1),
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'api',
          },
          id,
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const queueName = insertMock.mock.calls[0][0];
        const args = insertMock.mock.calls[0][1] as JobInsert[];
        expect(queueName).toBe('tiles-test');
        expect(args).toEqual([
          {
            ...queueConfig,
            data: { x: 39176, y: 10600, z: 18, metatile: 8, parent: id, state: undefined, force: undefined },
          },
        ]);
      });

      it('should filter out non intersected tiles for geojson request', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

        const [west, south, east, north] = bbox(GOOD_LARGE_FEATURE);
        const boundingBox = { west, south, east, north };

        const geojsonPromise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: GOOD_LARGE_FEATURE,
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'api',
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(geojsonPromise).resolves.not.toThrow();
        const geojsonInsertions = insertMock.mock.calls.length;

        const bboxPromise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: boundingBox,
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'api',
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(bboxPromise).resolves.not.toThrow();

        const bboxInsertions = insertMock.mock.calls.length - geojsonInsertions;

        expect(geojsonInsertions).toBeLessThan(bboxInsertions);
      });
    });

    describe('expired tiles requests', () => {
      it('should insert the tile to the queue', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());
        const id = faker.string.uuid();

        const promise = tilesManager.handleTileRequest({
          id,
          data: {
            items: [
              {
                area: BBOX1,
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'expiredTiles',
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const queueName = insertMock.mock.calls[0][0];
        const args = insertMock.mock.calls[0][1] as JobInsert[];
        expect(queueName).toBe('tiles-test');
        expect(args).toEqual([
          {
            ...queueConfig,
            data: { x: 39176, y: 10600, z: 18, metatile: 8, parent: id, state: undefined, force: undefined },
          },
        ]);
      });

      it('should insert the tile to the queue with force attribute if request configured so', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());
        const id = faker.string.uuid();

        const promise = tilesManager.handleTileRequest({
          id,
          data: {
            items: [
              {
                area: BBOX1,
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'expiredTiles',
            force: true,
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const queueName = insertMock.mock.calls[0][0];
        const args = insertMock.mock.calls[0][1] as JobInsert[];
        expect(queueName).toBe('tiles-test');
        expect(args).toEqual([
          {
            ...queueConfig,
            data: { x: 39176, y: 10600, z: 18, metatile: 8, parent: id, force: true, state: undefined },
          },
        ]);
      });

      it('should insert the tile to the queue with force attribute if app configured so', async function () {
        configMock = {
          ...configMock,
          get: jest.fn().mockImplementation((key: string) => {
            switch (key) {
              case 'app':
                return {
                  projectName: 'test',
                  tilesBatchSize: 10,
                  metatileSize: 8,
                  force: { expiredTiles: true },
                };
              case 'telemetry.metrics.buckets':
                return [];
              case 'queue': {
                const { retryDelay } = queueConfig;
                return { retryDelaySeconds: retryDelay, ...queueConfig };
              }
              default:
                break;
            }
          }),
        };

        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());
        const id = faker.string.uuid();

        const promise = tilesManager.handleTileRequest({
          id,
          data: {
            items: [
              {
                area: BBOX1,
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'expiredTiles',
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const queueName = insertMock.mock.calls[0][0];
        const args = insertMock.mock.calls[0][1] as JobInsert[];
        expect(queueName).toBe('tiles-test');
        expect(args).toEqual([
          {
            ...queueConfig,
            data: { x: 39176, y: 10600, z: 18, metatile: 8, parent: id, force: true, state: undefined },
          },
        ]);
      });

      it('should insert tiles in multiple zoom levels', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

        const promise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: BBOX1,
                minZoom: 16,
                maxZoom: 18,
              },
            ],
            source: 'expiredTiles',
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const args = insertMock.mock.calls[0][1] as JobInsert<Tile>[];
        expect(args.map((job) => job.data)).toContainSameTiles([
          { x: 9794, y: 2650, z: 16, metatile: 8 },
          { x: 39176, y: 10600, z: 18, metatile: 8 },
          { x: 19588, y: 5300, z: 17, metatile: 8 },
        ]);
      });

      it('should insert tiles with the parent state', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

        const promise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: BBOX1,
                minZoom: 16,
                maxZoom: 18,
              },
            ],
            source: 'expiredTiles',
            state: 666,
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const args = insertMock.mock.calls[0][1] as JobInsert<Tile>[];
        expect(args.map((job) => job.data)).toContainSameTiles([
          { x: 9794, y: 2650, z: 16, metatile: 8, state: 666 },
          { x: 39176, y: 10600, z: 18, metatile: 8, state: 666 },
          { x: 19588, y: 5300, z: 17, metatile: 8, state: 666 },
        ]);
      });

      it('should insert tiles into the queue in multiple batches', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());

        const promise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: BBOX2,
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'expiredTiles',
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(2);

        const firstCallArgs = insertMock.mock.calls[0][1] as JobInsert[];
        const secondCallArgs = insertMock.mock.calls[1][1] as JobInsert[];
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
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());
        const id = faker.string.uuid();

        const promise = tilesManager.handleTileRequest({
          id,
          data: {
            items: [
              {
                area: BBOX1,
                minZoom: 18,
                maxZoom: 18,
              },
              {
                area: BBOX1,
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'expiredTiles',
          },
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const queueName = insertMock.mock.calls[0][0];
        const args = insertMock.mock.calls[0][1] as JobInsert[];
        expect(queueName).toBe('tiles-test');
        expect(args).toEqual([
          {
            ...queueConfig,
            data: { x: 39176, y: 10600, z: 18, metatile: 8, parent: id, state: undefined, force: undefined },
          },
        ]);
      });

      it('should add the id of the tile request to the tiles', async function () {
        const insertMock = jest.fn().mockResolvedValue(['ok']);
        const tilesManager = new TilesManager({ insert: insertMock } as unknown as PgBoss, configMock, logger, queueNames, new client.Registry());
        const id = faker.string.uuid();

        const promise = tilesManager.handleTileRequest({
          data: {
            items: [
              {
                area: BBOX1,
                minZoom: 18,
                maxZoom: 18,
              },
            ],
            source: 'expiredTiles',
          },
          id,
        } as unknown as JobWithMetadata<TileRequestQueuePayload>);

        await expect(promise).resolves.not.toThrow();
        expect(insertMock).toHaveBeenCalledTimes(1);

        const queueName = insertMock.mock.calls[0][0];
        const args = insertMock.mock.calls[0][1] as JobInsert[];
        expect(queueName).toBe('tiles-test');
        expect(args).toEqual([
          {
            ...queueConfig,
            data: { x: 39176, y: 10600, z: 18, metatile: 8, parent: id, state: undefined, force: undefined },
          },
        ]);
      });
    });
  });
});
