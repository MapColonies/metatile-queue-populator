import { setTimeout as setTimeoutPromise } from 'timers/promises';
import jsLogger from '@map-colonies/js-logger';
import config from 'config';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import { container } from 'tsyringe';
import PgBoss from 'pg-boss';
import { Tile } from '@map-colonies/tile-calc';
import { getApp } from '../../../src/app';
import { SERVICES } from '../../../src/common/constants';
import { ShutdownHandler } from '../../../src/common/shutdownHandler';
import { TilesRequestSender } from './helpers/requestSender';
import { getBbox } from './helpers/generator';

describe('tiles', function () {
  afterAll(async function () {
    const handler = container.resolve(ShutdownHandler);
    await handler.shutdown();
  });

  describe('api', () => {
    let requestSender: TilesRequestSender;
    beforeAll(async function () {
      const app = await getApp({
        override: [
          {
            token: SERVICES.CONFIG,
            provider: {
              useValue: {
                get: (key: string) => {
                  if (key === 'app.projectName') {
                    return 'test-api';
                  } else if (key === 'app.enableRequestQueueHandling') {
                    return false;
                  } else {
                    return config.get(key);
                  }
                },
              },
            },
          },
          { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
          { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
        ],
      });
      requestSender = new TilesRequestSender(app);
    });

    describe('Happy Path', function () {
      it('should return ok', async function () {
        const bbox = getBbox();

        const response = await requestSender.postTilesRequest(bbox, 0, 1);

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
      });
    });
    describe('Bad Path', function () {
      it('should return 400 if the bbox is invalid', async function () {
        const bbox = getBbox();
        bbox[0] = bbox[2];

        const response = await requestSender.postTilesRequest(bbox, 0, 1);

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', "bounding box's east must be larger than west");
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 if the bbox north is not smaller than south', async function () {
        const bbox = getBbox();
        bbox[1] = bbox[3];

        const response = await requestSender.postTilesRequest(bbox, 0, 1);

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', "bounding box's north must be larger than south");
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 if the zoom is out of range', async function () {
        const bbox = getBbox();

        const response = await requestSender.postTilesRequest(bbox, -1, 1);

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', 'request.body.minZoom should be >= 0');
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 if minZoom is greater than maxZoom', async function () {
        const bbox = getBbox();

        const response = await requestSender.postTilesRequest(bbox, 1, 0);

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response.body).toHaveProperty('message', 'minZoom must be less than or equal to maxZoom');
        expect(response).toSatisfyApiSpec();
      });

      it('should return 409 if the request is already in queue', async function () {
        const bbox = getBbox();

        const response = await requestSender.postTilesRequest(bbox, 0, 1);
        expect(response.status).toBe(httpStatusCodes.OK);

        const response2 = await requestSender.postTilesRequest(bbox, 0, 1);

        expect(response2.status).toBe(httpStatusCodes.CONFLICT);
        expect(response2.body).toHaveProperty('message', 'Request already in queue');
        expect(response2).toSatisfyApiSpec();
      });
    });
    describe('Sad Path', function () {
      it('should return 500 if the queue is not available', async function () {
        const boss = container.resolve(PgBoss);
        jest.spyOn(boss, 'sendOnce').mockRejectedValueOnce(new Error('failed'));

        const bbox = getBbox();

        const response = await requestSender.postTilesRequest(bbox, 0, 1);
        expect(response.status).toBe(httpStatusCodes.INTERNAL_SERVER_ERROR);
      });
    });
  });
});

describe('tileRequestHandler', () => {
  beforeAll(async function () {
    const app = await getApp({
      override: [
        {
          token: SERVICES.CONFIG,
          provider: {
            useValue: {
              get: (key: string) => {
                if (key === 'app.projectName') {
                  return 'test-requests';
                } else if (key === 'app.enableRequestQueueHandling') {
                  return true;
                } else {
                  return config.get(key);
                }
              },
            },
          },
        },
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
      ],
    });
  });

  it('should add the tiles from the request into the queue', async () => {
    const boss = container.resolve(PgBoss);
    const request = {
      bbox: [{ west: 35.20076259970665, south: 31.770502933414285, east: 35.21034598016739, north: 31.80173210500818 }],
      maxZoom: 18,
      minZoom: 18,
      source: 'expiredTiles',
    };

    await boss.send('tiles-requests-test-requests', request);

    await setTimeoutPromise(2000);

    const result = await boss.fetch<Tile>('tiles-test-requests', 14);
    console.log(result);

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
});
