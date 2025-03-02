/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { setInterval as setIntervalPromise, setTimeout as setTimeoutPromise } from 'node:timers/promises';
import jsLogger from '@map-colonies/js-logger';
import { trace } from '@opentelemetry/api';
import { CleanupRegistry } from '@map-colonies/cleanup-registry';
import httpStatusCodes from 'http-status-codes';
import { DependencyContainer } from 'tsyringe';
import PgBoss from 'pg-boss';
import { Tile } from '@map-colonies/tile-calc';
import { type vectorMetatileQueuePopulatorV1Type } from '@map-colonies/schemas';
import { type FeatureCollection } from 'geojson';
import { bbox } from '@turf/turf';
import { ConfigType, getConfig, initConfig } from '@src/common/config';
import { getApp } from '../../../src/app';
import { JOB_QUEUE_PROVIDER, SERVICES } from '../../../src/common/constants';
import { PgBossJobQueueProvider } from '../../../src/tiles/jobQueueProvider/pgBossJobQueue';
import { consumeAndPopulateFactory } from '../../../src/requestConsumer';
import { BAD_FEATURE, BBOX1, BBOX2, GOOD_FEATURE, GOOD_LARGE_FEATURE } from '../../helpers/samples';
import { boundingBoxToPolygon } from '../../../src/tiles/models/util';
import { TilesRequestSender } from './helpers/requestSender';
import { getBbox } from './helpers/generator';

async function waitForJobToBeResolved(boss: PgBoss, jobId: string): Promise<PgBoss.JobWithMetadata | null> {
  // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars
  for await (const _unused of setIntervalPromise(10)) {
    const job = await boss.getJobById(jobId);
    if (job?.completedon) {
      return job;
    }
  }
  return null;
}

describe('tiles', function () {
  let config: ConfigType;

  beforeAll(async function () {
    await initConfig(true);
    config = getConfig();
  });

  describe('api', () => {
    let requestSender: TilesRequestSender;
    let container: DependencyContainer;

    beforeAll(async function () {
      const [app, depContainer] = await getApp({
        useChild: true,
        override: [
          {
            token: SERVICES.CONFIG,
            provider: {
              useValue: {
                get: ((key) => {
                  if (key === 'app') {
                    return {
                      ...config.get('app'),
                      projectName: 'app-api',
                      enableRequestQueueHandling: false,
                    } satisfies Partial<vectorMetatileQueuePopulatorV1Type['app']>;
                  }
                  return config.get(key);
                }) as ConfigType['get'],
                getAll: jest.fn(),
                getConfigParts: jest.fn(),
                getResolvedOptions: jest.fn(),
                initializeMetrics: config.initializeMetrics,
              } satisfies ConfigType,
            },
          },
          { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
          { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
        ],
      });
      container = depContainer;
      requestSender = new TilesRequestSender(app);
    });

    afterAll(async function () {
      const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
      await cleanupRegistry.trigger();
    });

    describe('Happy Path', function () {
      describe('POST /tiles/area', function () {
        it('should return 200 if the request is valid', async function () {
          const bbox = getBbox();

          const response = await requestSender.postTilesByAreaRequest({ area: bbox, minZoom: 0, maxZoom: 1 });

          expect(response.status).toBe(httpStatusCodes.OK);
          expect(response).toSatisfyApiSpec();
        });

        it('should return 200 if the array request is a valid single bbox', async function () {
          const bbox = getBbox();

          const response = await requestSender.postTilesByAreaRequest([{ area: bbox, minZoom: 0, maxZoom: 1 }]);

          expect(response.status).toBe(httpStatusCodes.OK);
          expect(response).toSatisfyApiSpec();
        });

        it('should return 200 if the multi area request is valid', async function () {
          const bbox1 = getBbox();
          const bbox2 = getBbox();

          const response = await requestSender.postTilesByAreaRequest([
            { area: bbox1, minZoom: 0, maxZoom: 1 },
            { area: bbox2, minZoom: 1, maxZoom: 2 },
          ]);

          expect(response.status).toBe(httpStatusCodes.OK);
          expect(response).toSatisfyApiSpec();
        });

        it('should return 200 if the multi area request is valid consisting geojson and bbox', async function () {
          const bbox1 = getBbox();

          const response = await requestSender.postTilesByAreaRequest([
            { area: bbox1, minZoom: 0, maxZoom: 1 },
            { area: GOOD_FEATURE, minZoom: 1, maxZoom: 2 },
          ]);

          expect(response.status).toBe(httpStatusCodes.OK);
          expect(response).toSatisfyApiSpec();
        });

        it('should return 200 if the multi area request is valid consisting geojson featureCollection and bbox', async function () {
          const bbox = getBbox();
          const featureCollection: FeatureCollection = {
            type: 'FeatureCollection',
            features: [GOOD_FEATURE, GOOD_FEATURE],
          };

          const response = await requestSender.postTilesByAreaRequest([
            { area: bbox, minZoom: 0, maxZoom: 1 },
            { area: featureCollection, minZoom: 1, maxZoom: 2 },
          ]);

          expect(response.status).toBe(httpStatusCodes.OK);
          expect(response).toSatisfyApiSpec();
        });

        it('should return 200 if the multi area request is valid with force attribute', async function () {
          const bbox = getBbox();
          const featureCollection: FeatureCollection = {
            type: 'FeatureCollection',
            features: [GOOD_FEATURE, GOOD_FEATURE],
          };

          const response = await requestSender.postTilesByAreaRequest(
            [
              { area: bbox, minZoom: 0, maxZoom: 1 },
              { area: featureCollection, minZoom: 1, maxZoom: 2 },
            ],
            true
          );

          expect(response.status).toBe(httpStatusCodes.OK);
          expect(response).toSatisfyApiSpec();
        });
      });

      describe('POST /tiles/list', function () {
        it('should return 200 if the request is valid', async function () {
          const response = await requestSender.postTilesList([{ z: 0, x: 0, y: 0, metatile: 8 }]);

          expect(response.status).toBe(httpStatusCodes.OK);

          expect(response).toSatisfyApiSpec();
        });

        it('should return 200 if the request is valid with force attibute', async function () {
          const response = await requestSender.postTilesList([{ z: 0, x: 0, y: 0, metatile: 8 }], true);

          expect(response.status).toBe(httpStatusCodes.OK);

          expect(response).toSatisfyApiSpec();
        });
      });
    });

    describe('Bad Path', function () {
      describe('POST /tiles/area', function () {
        it('should return 400 if the bbox is invalid', async function () {
          const bbox = getBbox();
          bbox[0] = bbox[2];

          const response = await requestSender.postTilesByAreaRequest({ area: bbox, minZoom: 0, maxZoom: 1 });

          expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
          expect(response.body).toHaveProperty('message', "bounding box's east must be larger than west");
          expect(response).toSatisfyApiSpec();
        });

        it('should return 400 if the bbox north is not smaller than south', async function () {
          const bbox = getBbox();
          bbox[1] = bbox[3];

          const response = await requestSender.postTilesByAreaRequest({ area: bbox, minZoom: 0, maxZoom: 1 });

          expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
          expect(response.body).toHaveProperty('message', "bounding box's north must be larger than south");
          expect(response).toSatisfyApiSpec();
        });

        it('should return 400 if the zoom is out of range', async function () {
          const bbox = getBbox();

          const response = await requestSender.postTilesByAreaRequest({ area: bbox, minZoom: -1, maxZoom: 1 });

          expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
          const message = (response.body as { message: string }).message;
          expect(message).toContain('request/body/minZoom must be >= 0');
          expect(response).toSatisfyApiSpec();
        });

        it('should return 400 if minZoom is greater than maxZoom', async function () {
          const bbox = getBbox();

          const response = await requestSender.postTilesByAreaRequest({ area: bbox, minZoom: 1, maxZoom: 0 });

          expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
          const message = (response.body as { message: string }).message;
          expect(message).toContain('minZoom must be less than or equal to maxZoom');
          expect(response).toSatisfyApiSpec();
        });

        it('should return 400 if the geojson is an invalid feature', async function () {
          const response = await requestSender.postTilesByAreaRequest({ area: BAD_FEATURE, minZoom: 0, maxZoom: 1 });

          expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
          const message = (response.body as { message: string }).message;
          expect(message).toContain('area is an invalid geojson');
          expect(response).toSatisfyApiSpec();
        });

        it('should return 400 if the geojson is an invalid featureCollection', async function () {
          const badFeatureCollection: FeatureCollection = {
            type: 'FeatureCollection',
            features: [GOOD_FEATURE, BAD_FEATURE],
          };

          const response = await requestSender.postTilesByAreaRequest({ area: badFeatureCollection, minZoom: 0, maxZoom: 1 });

          expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
          const message = (response.body as { message: string }).message;
          expect(message).toContain('area is an invalid geojson');
          expect(response).toSatisfyApiSpec();
        });

        it('should return 409 if the bbox request is already in queue', async function () {
          const bbox = getBbox();

          const response = await requestSender.postTilesByAreaRequest({ area: bbox, minZoom: 0, maxZoom: 1 });
          expect(response.status).toBe(httpStatusCodes.OK);

          const response2 = await requestSender.postTilesByAreaRequest({ area: bbox, minZoom: 0, maxZoom: 1 });

          expect(response2.status).toBe(httpStatusCodes.CONFLICT);
          expect(response2.body).toHaveProperty('message', 'Request already in queue');
          expect(response2).toSatisfyApiSpec();
        });

        it('should return 409 if the geojson request is already in queue', async function () {
          const bbox = getBbox();
          const [west, south, east, north] = bbox;
          const geojson = boundingBoxToPolygon({ west, south, east, north });

          const response = await requestSender.postTilesByAreaRequest({ area: geojson, minZoom: 0, maxZoom: 1 });
          expect(response.status).toBe(httpStatusCodes.OK);

          const response2 = await requestSender.postTilesByAreaRequest([{ area: geojson, minZoom: 0, maxZoom: 1 }]);

          expect(response2.status).toBe(httpStatusCodes.CONFLICT);
          expect(response2.body).toHaveProperty('message', 'Request already in queue');
          expect(response2).toSatisfyApiSpec();
        });

        it('should return 409 if the geojson is a featureCollection consisting the same feature that are already in queue', async function () {
          const featureCollection: FeatureCollection = {
            type: 'FeatureCollection',
            features: [GOOD_FEATURE],
          };

          const response = await requestSender.postTilesByAreaRequest({ area: GOOD_FEATURE, minZoom: 0, maxZoom: 1 });
          expect(response.status).toBe(httpStatusCodes.OK);

          const response2 = await requestSender.postTilesByAreaRequest([{ area: featureCollection, minZoom: 0, maxZoom: 1 }]);

          expect(response2.status).toBe(httpStatusCodes.CONFLICT);
          expect(response2.body).toHaveProperty('message', 'Request already in queue');
          expect(response2).toSatisfyApiSpec();
        });
      });

      describe('POST /tiles/list', function () {
        it('should return 400 if the body is not a list', async function () {
          const response = await requestSender.postTilesList({} as []);

          expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
          expect(response.body).toHaveProperty('message', 'request/body must be array');
          expect(response).toSatisfyApiSpec();
        });

        it('should return 400 if the body is empty', async function () {
          const response = await requestSender.postTilesList([]);

          expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
          expect(response.body).toHaveProperty('message', 'request/body must NOT have fewer than 1 items');
          expect(response).toSatisfyApiSpec();
        });

        it('should return 400 if the body is not a valid tile', async function () {
          const response = await requestSender.postTilesList([{ x: 0, y: 0 } as Tile]);

          expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
          expect(response.body).toHaveProperty('message', "request/body/0 must have required property 'z'");
          expect(response).toSatisfyApiSpec();
        });

        it('should return 400 if the body contains tile that is out of bounds', async function () {
          const response = await requestSender.postTilesList([{ z: 0, x: 1, y: 1, metatile: 8 } as Tile]);

          expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
          expect(response.body).toHaveProperty('message', 'x index out of range of tile grid');
          expect(response).toSatisfyApiSpec();
        });
      });
    });

    describe('Sad Path', function () {
      describe('POST /tiles/area', function () {
        it('should return 500 if the queue is not available', async function () {
          const boss = container.resolve(PgBoss);
          jest.spyOn(boss, 'sendOnce').mockRejectedValueOnce(new Error('failed'));

          const bbox = getBbox();

          const response = await requestSender.postTilesByAreaRequest({ area: bbox, minZoom: 0, maxZoom: 1 });
          expect(response.status).toBe(httpStatusCodes.INTERNAL_SERVER_ERROR);
        });
      });

      describe('POST /tiles/list', function () {
        it('should return 500 if the queue is not available', async function () {
          const boss = container.resolve(PgBoss);
          jest.spyOn(boss, 'insert').mockRejectedValueOnce(new Error('failed'));

          const response = await requestSender.postTilesList([{ z: 0, x: 0, y: 0, metatile: 8 }]);
          expect(response.status).toBe(httpStatusCodes.INTERNAL_SERVER_ERROR);
        });
      });
    });
  });

  describe('tileRequestHandler', () => {
    let container: DependencyContainer;

    beforeAll(async function () {
      const [, depContainer] = await getApp({
        useChild: true,
        override: [
          {
            token: SERVICES.CONFIG,
            provider: {
              useValue: {
                get: ((key: string) => {
                  if (key === 'app') {
                    return {
                      ...config.get('app'),
                      projectName: 'test-requests',
                      tilesBatchSize: 10,
                      metatileSize: 8,
                      enableRequestQueueHandling: true,
                      requestQueueCheckIntervalSec: 1,
                      consumeDelay: {
                        enabled: false,
                      },
                    } satisfies Partial<vectorMetatileQueuePopulatorV1Type['app']>;
                  }
                  return config.get(key);
                }) as ConfigType['get'],
                getAll: jest.fn(),
                getConfigParts: jest.fn(),
                getResolvedOptions: jest.fn(),
                initializeMetrics: config.initializeMetrics,
              } satisfies ConfigType,
            },
          },
          { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
          { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
        ],
      });
      container = depContainer;
    });

    beforeEach(async function () {
      const boss = container.resolve(PgBoss);
      await boss.clearStorage();
    });

    afterAll(async function () {
      const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
      await cleanupRegistry.trigger();
    });

    it('should add the tiles from the expireTiles bbox request into the queue', async () => {
      const boss = container.resolve(PgBoss);
      const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
      provider.startQueue();
      const consumeAndPopulatePromise = consumeAndPopulateFactory(container)();

      const request = {
        items: [
          {
            area: BBOX2,
            minZoom: 18,
            maxZoom: 18,
          },
        ],
        source: 'expiredTiles',
      };

      const jobId = await boss.send('tiles-requests-test-requests', request);

      await waitForJobToBeResolved(boss, jobId as string);

      provider.stopQueue();

      await expect(consumeAndPopulatePromise).resolves.not.toThrow();

      const result = await boss.fetch<Tile>('tiles-test-requests', 14);
      expect(result).not.toBeNull();

      await boss.complete(result!.map((r) => r.id));
      expect(result!.map((r) => r.data)).toContainSameTiles([
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

    it('should add the tiles from the expireTiles bbox request into the queue with force and state if attributed so', async () => {
      const boss = container.resolve(PgBoss);
      const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
      provider.startQueue();
      const consumeAndPopulatePromise = consumeAndPopulateFactory(container)();

      const request = {
        items: [
          {
            area: BBOX2,
            minZoom: 18,
            maxZoom: 18,
          },
        ],
        source: 'expiredTiles',
        force: true,
        state: 100,
      };

      const jobId = await boss.send('tiles-requests-test-requests', request);

      await waitForJobToBeResolved(boss, jobId as string);

      provider.stopQueue();

      await expect(consumeAndPopulatePromise).resolves.not.toThrow();

      const result = await boss.fetch<Tile>('tiles-test-requests', 14);
      expect(result).not.toBeNull();

      await boss.complete(result!.map((r) => r.id));
      expect(result!.map((r) => r.data)).toContainSameTiles([
        { x: 39177, y: 10594, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39176, y: 10594, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39176, y: 10595, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39176, y: 10596, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39177, y: 10595, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39177, y: 10596, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39177, y: 10597, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39176, y: 10597, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39176, y: 10598, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39176, y: 10599, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39177, y: 10598, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39177, y: 10599, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39177, y: 10600, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39176, y: 10600, z: 18, metatile: 8, force: true, state: 100 },
      ]);
    });

    it('should add the tiles from the geojson api request into the queue', async () => {
      const boss = container.resolve(PgBoss);
      const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
      provider.startQueue();
      const consumeAndPopulatePromise = consumeAndPopulateFactory(container)();

      const request = {
        items: [
          {
            area: boundingBoxToPolygon(BBOX2),
            minZoom: 18,
            maxZoom: 18,
          },
        ],
        source: 'api',
      };

      const jobId = await boss.send('tiles-requests-test-requests', request);

      await waitForJobToBeResolved(boss, jobId as string);

      provider.stopQueue();

      await expect(consumeAndPopulatePromise).resolves.not.toThrow();

      const result = await boss.fetch<Tile>('tiles-test-requests', 14);
      expect(result).not.toBeNull();

      await boss.complete(result!.map((r) => r.id));
      expect(result!.map((r) => r.data)).toContainSameTiles([
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

    it('should add the tiles from the geojson api request into the queue with force attribute', async () => {
      const boss = container.resolve(PgBoss);
      const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
      provider.startQueue();
      const consumeAndPopulatePromise = consumeAndPopulateFactory(container)();

      const request = {
        items: [
          {
            area: boundingBoxToPolygon(BBOX2),
            minZoom: 18,
            maxZoom: 18,
          },
        ],
        source: 'api',
        force: true,
      };

      const jobId = await boss.send('tiles-requests-test-requests', request);

      await waitForJobToBeResolved(boss, jobId as string);

      provider.stopQueue();

      await expect(consumeAndPopulatePromise).resolves.not.toThrow();

      const result = await boss.fetch<Tile>('tiles-test-requests', 14);
      expect(result).not.toBeNull();

      await boss.complete(result!.map((r) => r.id));
      expect(result!.map((r) => r.data)).toContainSameTiles([
        { x: 39177, y: 10594, z: 18, metatile: 8, force: true },
        { x: 39176, y: 10594, z: 18, metatile: 8, force: true },
        { x: 39176, y: 10595, z: 18, metatile: 8, force: true },
        { x: 39176, y: 10596, z: 18, metatile: 8, force: true },
        { x: 39177, y: 10595, z: 18, metatile: 8, force: true },
        { x: 39177, y: 10596, z: 18, metatile: 8, force: true },
        { x: 39177, y: 10597, z: 18, metatile: 8, force: true },
        { x: 39176, y: 10597, z: 18, metatile: 8, force: true },
        { x: 39176, y: 10598, z: 18, metatile: 8, force: true },
        { x: 39176, y: 10599, z: 18, metatile: 8, force: true },
        { x: 39177, y: 10598, z: 18, metatile: 8, force: true },
        { x: 39177, y: 10599, z: 18, metatile: 8, force: true },
        { x: 39177, y: 10600, z: 18, metatile: 8, force: true },
        { x: 39176, y: 10600, z: 18, metatile: 8, force: true },
      ]);
    });

    it('should add the tiles from the api bbox request into the queue', async () => {
      const boss = container.resolve(PgBoss);
      const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
      provider.startQueue();
      const consumeAndPopulatePromise = consumeAndPopulateFactory(container)();

      const request = {
        items: [
          {
            area: BBOX2,
            minZoom: 18,
            maxZoom: 18,
          },
        ],
        source: 'api',
      };

      const jobId = await boss.send('tiles-requests-test-requests', request);

      await waitForJobToBeResolved(boss, jobId as string);

      provider.stopQueue();

      await expect(consumeAndPopulatePromise).resolves.not.toThrow();

      const result = await boss.fetch<Tile>('tiles-test-requests', 14);
      expect(result).not.toBeNull();

      await boss.complete(result!.map((r) => r.id));
      expect(result!.map((r) => r.data)).toContainSameTiles([
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

    it('should add the tiles from the api multi areal request into the queue', async () => {
      const boss = container.resolve(PgBoss);
      const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
      provider.startQueue();
      const consumeAndPopulatePromise = consumeAndPopulateFactory(container)();

      const request = {
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
      };

      const jobId = await boss.send('tiles-requests-test-requests', request);

      await waitForJobToBeResolved(boss, jobId as string);

      provider.stopQueue();

      await expect(consumeAndPopulatePromise).resolves.not.toThrow();

      const result = await boss.fetch<Tile>('tiles-test-requests', 15);
      expect(result).not.toBeNull();

      await boss.complete(result!.map((r) => r.id));
      expect(result!.map((r) => r.data)).toContainSameTiles([
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

    it('should filter out non intersected tiles for geojson request', async () => {
      const boss = container.resolve(PgBoss);
      const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
      provider.startQueue();
      const consumeAndPopulatePromise = consumeAndPopulateFactory(container)();

      const [west, south, east, north] = bbox(GOOD_LARGE_FEATURE);
      const boundingBox = { west, south, east, north };

      const geojsonRequest = {
        items: [
          {
            area: GOOD_LARGE_FEATURE,
            minZoom: 18,
            maxZoom: 18,
          },
        ],
        source: 'api',
      };

      const jobId1 = await boss.send('tiles-requests-test-requests', geojsonRequest);

      await waitForJobToBeResolved(boss, jobId1 as string);

      const geojsonResult = await boss.fetch<Tile>('tiles-test-requests', 1000);

      const bboxRequest = {
        items: [
          {
            area: boundingBox,
            minZoom: 18,
            maxZoom: 18,
          },
        ],
        source: 'api',
      };

      const jobId2 = await boss.send('tiles-requests-test-requests', bboxRequest);

      await waitForJobToBeResolved(boss, jobId2 as string);

      provider.stopQueue();

      await expect(consumeAndPopulatePromise).resolves.not.toThrow();

      const bboxResult = await boss.fetch<Tile>('tiles-test-requests', 1000);

      expect(geojsonResult).not.toBeNull();
      expect(bboxResult).not.toBeNull();
      expect(geojsonResult!.length).toBeLessThan(bboxResult!.length);
    });
  });

  describe('tileRequestHandlerWithDelay', () => {
    let container: DependencyContainer;

    beforeAll(async function () {
      const [, depContainer] = await getApp({
        useChild: true,
        override: [
          {
            token: SERVICES.CONFIG,
            provider: {
              useValue: {
                get: ((key: string) => {
                  if (key === 'app') {
                    return {
                      ...config.get('app'),
                      projectName: 'test-requests',
                      tilesBatchSize: 10,
                      metatileSize: 8,
                      enableRequestQueueHandling: true,
                      requestQueueCheckIntervalSec: 1,
                      consumeDelay: {
                        enabled: true,
                        delaySec: 1,
                        tilesQueueSizeLimit: 2,
                      },
                    } satisfies Partial<vectorMetatileQueuePopulatorV1Type['app']>;
                  }
                  return config.get(key);
                }) as ConfigType['get'],
                getAll: jest.fn(),
                getConfigParts: jest.fn(),
                getResolvedOptions: jest.fn(),
                initializeMetrics: config.initializeMetrics,
              } satisfies ConfigType,
            },
          },
          { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
          { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
        ],
      });
      container = depContainer;
    });

    beforeEach(async function () {
      const boss = container.resolve(PgBoss);
      await boss.clearStorage();
    });

    afterAll(async function () {
      const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
      await cleanupRegistry.trigger();
    });

    it('should delay the consumption of the requests queue if tiles queue is overflowing', async () => {
      const boss = container.resolve(PgBoss);
      const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
      provider.startQueue();
      const consumeAndPopulatePromise = consumeAndPopulateFactory(container)();

      const request1 = {
        items: [
          {
            area: BBOX2,
            minZoom: 18,
            maxZoom: 18,
          },
        ],
        source: 'expiredTiles',
      };

      const jobId1 = await boss.send('tiles-requests-test-requests', request1);

      await waitForJobToBeResolved(boss, jobId1 as string);

      const geojsonResult = await boss.fetch<Tile>('tiles-test-requests', 5000);

      const bboxRequest = {
        items: [
          {
            area: BBOX1,
            minZoom: 18,
            maxZoom: 18,
          },
        ],
        source: 'api',
      };

      await boss.send('tiles-requests-test-requests', bboxRequest);

      await setTimeoutPromise(2000);

      provider.stopQueue();

      await expect(consumeAndPopulatePromise).resolves.not.toThrow();

      const bboxResult = await boss.fetch<Tile>('tiles-test-requests', 1000);

      expect(geojsonResult).not.toBeNull();
      expect(bboxResult).toBeNull();
      const currentRequestsQueueSize = await boss.getQueueSize('tiles-requests-test-requests');
      expect(currentRequestsQueueSize).toBe(1);
    });
  });

  describe('tileRequestHandlerWithForce', () => {
    let container: DependencyContainer;

    beforeAll(async function () {
      const [, depContainer] = await getApp({
        useChild: true,
        override: [
          {
            token: SERVICES.CONFIG,
            provider: {
              useValue: {
                get: ((key: string) => {
                  if (key === 'app') {
                    return {
                      ...config.get('app'),
                      projectName: 'test-requests',
                      tilesBatchSize: 10,
                      metatileSize: 8,
                      enableRequestQueueHandling: true,
                      requestQueueCheckIntervalSec: 1,
                      consumeDelay: {
                        enabled: false,
                      },
                      force: {
                        api: true,
                        expiredTiles: true,
                      },
                    } satisfies Partial<vectorMetatileQueuePopulatorV1Type['app']>;
                  }
                  return config.get(key);
                }) as ConfigType['get'],
                getAll: jest.fn(),
                getConfigParts: jest.fn(),
                getResolvedOptions: jest.fn(),
                initializeMetrics: config.initializeMetrics,
              } satisfies ConfigType,
            },
          },
          { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
          { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
        ],
      });
      container = depContainer;
    });

    beforeEach(async function () {
      const boss = container.resolve(PgBoss);
      await boss.clearStorage();
    });

    afterAll(async function () {
      const cleanupRegistry = container.resolve<CleanupRegistry>(SERVICES.CLEANUP_REGISTRY);
      await cleanupRegistry.trigger();
    });

    it('should add the tiles from the expireTiles bbox request into the queue with force and state if attributed so', async () => {
      const boss = container.resolve(PgBoss);
      const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
      provider.startQueue();
      const consumeAndPopulatePromise = consumeAndPopulateFactory(container)();

      const request = {
        items: [
          {
            area: BBOX2,
            minZoom: 18,
            maxZoom: 18,
          },
        ],
        source: 'expiredTiles',
        state: 100,
      };

      const jobId = await boss.send('tiles-requests-test-requests', request);

      await waitForJobToBeResolved(boss, jobId as string);

      provider.stopQueue();

      await expect(consumeAndPopulatePromise).resolves.not.toThrow();

      const result = await boss.fetch<Tile>('tiles-test-requests', 14);
      expect(result).not.toBeNull();

      await boss.complete(result!.map((r) => r.id));
      expect(result!.map((r) => r.data)).toContainSameTiles([
        { x: 39177, y: 10594, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39176, y: 10594, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39176, y: 10595, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39176, y: 10596, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39177, y: 10595, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39177, y: 10596, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39177, y: 10597, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39176, y: 10597, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39176, y: 10598, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39176, y: 10599, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39177, y: 10598, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39177, y: 10599, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39177, y: 10600, z: 18, metatile: 8, force: true, state: 100 },
        { x: 39176, y: 10600, z: 18, metatile: 8, force: true, state: 100 },
      ]);
    });

    it('should add the tiles from the geojson api request into the queue with force attribute', async () => {
      const boss = container.resolve(PgBoss);
      const provider = container.resolve<PgBossJobQueueProvider>(JOB_QUEUE_PROVIDER);
      provider.startQueue();
      const consumeAndPopulatePromise = consumeAndPopulateFactory(container)();

      const request = {
        items: [
          {
            area: boundingBoxToPolygon(BBOX2),
            minZoom: 18,
            maxZoom: 18,
          },
        ],
        source: 'api',
      };

      const jobId = await boss.send('tiles-requests-test-requests', request);

      await waitForJobToBeResolved(boss, jobId as string);

      provider.stopQueue();

      await expect(consumeAndPopulatePromise).resolves.not.toThrow();

      const result = await boss.fetch<Tile>('tiles-test-requests', 14);
      expect(result).not.toBeNull();

      await boss.complete(result!.map((r) => r.id));
      expect(result!.map((r) => r.data)).toContainSameTiles([
        { x: 39177, y: 10594, z: 18, metatile: 8, force: true },
        { x: 39176, y: 10594, z: 18, metatile: 8, force: true },
        { x: 39176, y: 10595, z: 18, metatile: 8, force: true },
        { x: 39176, y: 10596, z: 18, metatile: 8, force: true },
        { x: 39177, y: 10595, z: 18, metatile: 8, force: true },
        { x: 39177, y: 10596, z: 18, metatile: 8, force: true },
        { x: 39177, y: 10597, z: 18, metatile: 8, force: true },
        { x: 39176, y: 10597, z: 18, metatile: 8, force: true },
        { x: 39176, y: 10598, z: 18, metatile: 8, force: true },
        { x: 39176, y: 10599, z: 18, metatile: 8, force: true },
        { x: 39177, y: 10598, z: 18, metatile: 8, force: true },
        { x: 39177, y: 10599, z: 18, metatile: 8, force: true },
        { x: 39177, y: 10600, z: 18, metatile: 8, force: true },
        { x: 39176, y: 10600, z: 18, metatile: 8, force: true },
      ]);
    });
  });
});
