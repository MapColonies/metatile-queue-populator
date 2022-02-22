import jsLogger from '@map-colonies/js-logger';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import { container } from 'tsyringe';
import PgBoss from 'pg-boss';
import { getApp } from '../../../src/app';
import { PROJECT_NAME_SYMBOL, SERVICES } from '../../../src/common/constants';
import { ShutdownHandler } from '../../../src/common/shutdownHandler';
import { TilesRequestSender } from './helpers/requestSender';
import { getBbox } from './helpers/generator';

const queueName = 'tilesInsert';

describe('tiles', function () {
  let requestSender: TilesRequestSender;
  beforeAll(async function () {
    const app = await getApp({
      override: [
        { token: PROJECT_NAME_SYMBOL, provider: { useValue: queueName } },
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
      ],
    });
    requestSender = new TilesRequestSender(app);
  });

  afterAll(async function () {
    const handler = container.resolve(ShutdownHandler);
    await handler.shutdown();
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
