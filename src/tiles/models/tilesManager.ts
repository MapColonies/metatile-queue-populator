import { randomUUID as uuidv4 } from 'crypto';
import { type Logger } from '@map-colonies/js-logger';
import { BoundingBox, boundingBoxToTiles as boundingBoxToTilesGenerator, Tile, tileToBoundingBox } from '@map-colonies/tile-calc';
import { API_STATE } from '@map-colonies/detiler-common';
import { type PgBoss, JobInsert, JobWithMetadata } from 'pg-boss';
import { inject, injectable } from 'tsyringe';
import client from 'prom-client';
import booleanIntersects from '@turf/boolean-intersects';
import { Feature } from 'geojson';
import { type ConfigType } from '@src/common/config';
import { snakeCase } from 'snake-case';
import { QUEUES_NAME, SERVICES } from '../../common/constants';
import { JobInsertConfig } from '../../common/interfaces';
import { hashValue } from '../../common/util';
import { PGBOSS_PROVIDER } from '../jobQueueProvider/pgbossFactory';
import { type QueuesName } from '../jobQueueProvider/queuesNameFactory';
import { Source, TileQueuePayload, TileRequestQueuePayload, TilesByAreaRequest } from './tiles';
import { RequestAlreadyInQueueError } from './errors';
import { TILE_REQUEST_QUEUE_NAME_PREFIX, TILES_QUEUE_NAME_PREFIX } from './constants';
import { areaToBoundingBox, boundingBoxToPolygon, stringifyTile } from './util';

@injectable()
export class TilesManager {
  public readonly requestQueueName: string;
  public readonly tilesQueueName: string;

  private readonly metatilesPopulatedCounter?: client.Counter<'source' | 'z'>;
  private readonly requestsHandledCounter?: client.Counter<'source' | 'retrycount'>;
  private readonly requestBatchesHandledCounter?: client.Counter<'source'>;
  private readonly populateHistogram?: client.Histogram<'source'>;

  private readonly batchSize: number;
  private readonly metatile: number;
  private readonly shouldForceApiTiles: boolean;
  private readonly shouldForceExpiredTiles: boolean;
  private readonly baseQueueConfig: JobInsertConfig;

  public constructor(
    @inject(PGBOSS_PROVIDER) private readonly pgboss: PgBoss,
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(QUEUES_NAME) private readonly queuesName: QueuesName,
    @inject(SERVICES.METRICS) registry?: client.Registry
  ) {
    const appConfig = config.get('app');
    this.requestQueueName = this.queuesName.requestQueue;
    this.tilesQueueName = this.queuesName.tilesQueue;
    this.batchSize = appConfig.tilesBatchSize;
    this.metatile = appConfig.metatileSize;
    this.shouldForceApiTiles = appConfig.force.api;
    this.shouldForceExpiredTiles = appConfig.force.expiredTiles;

    const { retryDelaySeconds, ...queueConfig } = config.get('queue');
    this.baseQueueConfig = { retryDelay: retryDelaySeconds, ...queueConfig };

    this.logger.info({
      msg: 'tiles manager initialized',
      requestQueueName: this.requestQueueName,
      tilesQueueName: this.tilesQueueName,
      ...this.baseQueueConfig,
      batchSize: this.batchSize,
      metatile: this.metatile,
      force: appConfig.force,
    });

    if (registry !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      [
        { type: snakeCase(TILE_REQUEST_QUEUE_NAME_PREFIX), name: this.requestQueueName },
        { type: snakeCase(TILES_QUEUE_NAME_PREFIX), name: this.tilesQueueName },
      ].forEach((queue) => {
        new client.Gauge({
          name: `metatile_queue_populator_${queue.type}_queue_current_count`,
          help: `The number of jobs currently in the ${queue.type} queue`,
          async collect(): Promise<void> {
            const { totalCount } = await self.pgboss.getQueueStats(queue.name);
            this.set(totalCount);
          },
          registers: [registry],
        });
      });

      this.metatilesPopulatedCounter = new client.Counter({
        name: 'metatile_queue_populator_metatiles_populated',
        help: 'The total number of tiles populated',
        labelNames: ['source', 'z'] as const,
        registers: [registry],
      });

      this.requestsHandledCounter = new client.Counter({
        name: 'metatile_queue_populator_populate_requests_handled',
        help: 'The total number of populate requests handled',
        labelNames: ['source', 'retrycount'] as const,
        registers: [registry],
      });

      this.requestBatchesHandledCounter = new client.Counter({
        name: 'metatile_queue_populator_request_batches_handled',
        help: 'The total number of request batches handled',
        labelNames: ['source'] as const,
        registers: [registry],
      });

      this.populateHistogram = new client.Histogram({
        name: 'metatile_queue_populator_population_seconds',
        help: 'metatile-queue-populator population duration by source',
        buckets: config.get('telemetry.metrics.buckets'),
        labelNames: ['source'] as const,
        registers: [registry],
      });
    }
  }

  public async addArealTilesRequestToQueue(request: TilesByAreaRequest[], force?: boolean): Promise<void> {
    const payload: TileRequestQueuePayload = {
      items: request.flatMap((item) => {
        if (Array.isArray(item.area)) {
          const [west, south, east, north] = item.area;
          return { ...item, area: { west, south, east, north } };
        }

        if (item.area.type === 'FeatureCollection') {
          return item.area.features.map((feature) => ({ ...item, area: feature }));
        }

        return { ...item, area: item.area };
      }),
      source: 'api',
      state: API_STATE,
      force: this.shouldForceApiTiles ? this.shouldForceApiTiles : force,
    };

    const key = hashValue(payload);
    //TODO: fix typescript error
    const singletonSeconds = this.baseQueueConfig.expireInSeconds as number;

    this.logger.debug({ msg: 'pushing payload to queue', queueName: this.requestQueueName, key, payload, itemCount: payload.items.length });

    const res = await this.pgboss.send(this.requestQueueName, payload, { ...this.baseQueueConfig, singletonKey: key, singletonSeconds });

    if (res === null) {
      this.logger.error({ msg: 'request already in queue', queueName: this.requestQueueName, key, payload });
      throw new RequestAlreadyInQueueError('Request already in queue');
    }
  }

  public async addTilesToQueue(tiles: Tile[], force?: boolean): Promise<void> {
    const requestId = uuidv4();

    this.logger.debug({ msg: 'inserting tiles to queue', queueName: this.tilesQueueName, parent: requestId, itemCount: tiles.length });

    const tileJobsArr = tiles.map((tile) => ({
      ...this.baseQueueConfig,
      data: { ...tile, parent: requestId, state: API_STATE, force: this.shouldForceApiTiles ? this.shouldForceApiTiles : force },
    }));
    await this.populateTilesQueue(tileJobsArr, 'api');
  }

  public async isAlive(): Promise<void> {
    await this.pgboss.getQueueStats(this.requestQueueName);
  }

  public async handleTileRequest(job: JobWithMetadata<TileRequestQueuePayload>): Promise<void> {
    this.logger.info({
      msg: 'handling tile request',
      queueName: this.requestQueueName,
      jobId: job.id,
      itemCount: job.data.items.length,
      source: job.data.source,
      retryCount: job.retryCount,
      retryLimit: this.baseQueueConfig.retryLimit,
      state: job.data.state,
      isForced: job.data.force,
    });

    this.logger.debug({ msg: 'handling the following tile request', queueName: this.requestQueueName, jobId: job.id, job });

    const fetchTimerEnd = this.populateHistogram?.startTimer({ source: job.data.source });

    if (job.data.source === 'api') {
      await this.handleApiTileRequest(job);
    } else {
      await this.handleExpiredTileRequest(job as JobWithMetadata<TileRequestQueuePayload<BoundingBox>>);
    }

    if (fetchTimerEnd) {
      fetchTimerEnd();
    }

    this.requestsHandledCounter?.inc({ source: job.data.source, retrycount: job.retryCount });
  }

  private async handleApiTileRequest(job: JobWithMetadata<TileRequestQueuePayload>): Promise<void> {
    const {
      data: { items, state, force },
      id,
    } = job;
    const isTileForced = this.shouldForceApiTiles ? this.shouldForceApiTiles : force;

    let tileArr: JobInsert<TileQueuePayload>[] = [];

    for (const { area, minZoom, maxZoom } of items) {
      const { bbox: itemBBox, fromGeojson } = areaToBoundingBox(area);

      for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
        for await (const tile of boundingBoxToTilesGenerator(itemBBox, zoom, this.metatile)) {
          if (fromGeojson) {
            const tileBbox = tileToBoundingBox(tile);
            if (!booleanIntersects(boundingBoxToPolygon(tileBbox), area as Feature)) {
              continue;
            }
          }
          tileArr.push({ ...this.baseQueueConfig, data: { ...tile, parent: id, state, force: isTileForced } });
          if (tileArr.length >= this.batchSize) {
            await this.populateTilesQueue(tileArr, 'api');
            tileArr = [];
          }
        }
      }
    }

    if (tileArr.length > 0) {
      await this.populateTilesQueue(tileArr, 'api');
    }
  }

  private async handleExpiredTileRequest(job: JobWithMetadata<TileRequestQueuePayload<BoundingBox>>): Promise<void> {
    const {
      data: { items, state, force },
      id,
    } = job;
    const isTileForced = this.shouldForceExpiredTiles ? this.shouldForceExpiredTiles : force;

    const tileMap = new Map<string, JobInsert<TileQueuePayload>>();

    for (const { area, minZoom, maxZoom } of items) {
      for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
        const tilesGenerator = boundingBoxToTilesGenerator(area, zoom, this.metatile);
        for await (const tile of tilesGenerator) {
          tileMap.set(stringifyTile(tile), {
            ...this.baseQueueConfig,
            data: { ...tile, parent: id, state, force: isTileForced },
          });
          if (tileMap.size >= this.batchSize) {
            await this.populateTilesQueue(Array.from(tileMap.values()), 'expiredTiles');
            tileMap.clear();
          }
        }
      }
    }

    if (tileMap.size > 0) {
      await this.populateTilesQueue(Array.from(tileMap.values()), 'expiredTiles');
    }
  }

  private async populateTilesQueue(tiles: JobInsert<TileQueuePayload>[], source: Source): Promise<void> {
    this.logger.info({ msg: 'populating tiles queue', queueName: this.tilesQueueName, itemCount: tiles.length, source });

    await this.pgboss.insert(this.tilesQueueName, tiles);

    tiles.forEach((tile) => this.metatilesPopulatedCounter?.inc({ source, z: tile.data?.z }));
    this.requestBatchesHandledCounter?.inc({ source });
  }
}
