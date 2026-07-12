import { randomUUID as uuidv4 } from 'crypto';
import { type Logger } from '@map-colonies/js-logger';
import { BoundingBox, boundingBoxToTiles as boundingBoxToTilesGenerator, Tile, tileToBoundingBox, lonLatZoomToTile } from '@map-colonies/tile-calc';
import { API_STATE } from '@map-colonies/detiler-common';
import { type PgBoss, JobInsert, JobWithMetadata } from 'pg-boss';
import { inject, injectable } from 'tsyringe';
import client from 'prom-client';
import booleanIntersects from '@turf/boolean-intersects';
import { Feature } from 'geojson';
import { type ConfigType } from '@src/common/config';
import { snakeCase } from 'snake-case';
import { SERVICES } from '../../common/constants';
import { JobInsertConfig } from '../../common/interfaces';
import { hashValue } from '../../common/util';
import { PGBOSS_PROVIDER } from '../jobQueueProvider/pgbossFactory';
import { LastTile, Source, StartPosition, TileQueuePayload, TileRequestQueuePayload, TilesByAreaRequest } from './tiles';
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
    @inject(SERVICES.METRICS) registry?: client.Registry
  ) {
    const appConfig = config.get('app');
    this.requestQueueName = `${TILE_REQUEST_QUEUE_NAME_PREFIX}-${appConfig.projectName}`;
    this.tilesQueueName = `${TILES_QUEUE_NAME_PREFIX}-${appConfig.projectName}`;
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
    const priority = request.reduce((max, item) => Math.max(max, item.priority ?? 0), 0);

    const items = request.flatMap((item) => {
      if (Array.isArray(item.area)) {
        const [west, south, east, north] = item.area;
        return { ...item, area: { west, south, east, north } };
      }
      if (item.area.type === 'FeatureCollection') {
        return item.area.features.map((feature) => ({ ...item, area: feature }));
      }
      return { ...item, area: item.area };
    });

    const payload: TileRequestQueuePayload = {
      items,
      source: 'api',
      state: API_STATE,
      force: this.shouldForceApiTiles ? this.shouldForceApiTiles : force,
      batchIndex: 0,
      itemIndex: 0,
      priority,
    };

    const key = hashValue(payload);

    this.logger.debug({ msg: 'pushing payload to queue', queueName: this.requestQueueName, key, payload, itemCount: payload.items.length });

    const res = await this.pgboss.send(this.requestQueueName, payload, {
      ...this.baseQueueConfig,
      singletonKey: key,
      singletonSeconds: 60,
      priority,
    });

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

  private async handleApiTileRequest(job: JobWithMetadata<TileRequestQueuePayload<BoundingBox | Feature>>): Promise<void> {
    const {
      data: { items, state, force, batchIndex = 0, itemIndex = 0, priority = 0, lastTile },
      id,
    } = job;
    const totalBatches = batchIndex === 0 && itemIndex === 0 ? this.computeTotalBatches(items) : job.data.totalBatches;
    const isTileForced = this.shouldForceApiTiles ? this.shouldForceApiTiles : force;

    this.logger.debug({ msg: 'handling api tile request batch', jobId: id, itemIndex, batchIndex, lastTile });

    if (itemIndex >= items.length) {
      this.logger.warn({ msg: 'item index is out of range, nothing to process', jobId: id, itemIndex, itemCount: items.length });
      return;
    }

    const { area, minZoom, maxZoom } = items[itemIndex];
    const { bbox: itemBBox, fromGeojson } = areaToBoundingBox(area);
    const start: StartPosition = lastTile ? this.resolveStartPosition(itemBBox, lastTile) : { z: minZoom };

    this.logger.info({
      msg: 'tile generation start',
      jobId: id,
      bbox: itemBBox,
      minZoom,
      maxZoom,
      startZoom: start.z,
      startX: start.x,
      startY: start.y,
      fromGeojson,
    });

    const tileArr: JobInsert<TileQueuePayload>[] = [];
    let lastCollectedTile: LastTile | undefined;

    for (const tile of this.generateItemTiles(area, itemBBox, fromGeojson, start, maxZoom)) {
      if (tileArr.length >= this.batchSize) {
        break;
      }
      tileArr.push({ ...this.baseQueueConfig, priority, data: { ...tile, parent: id, state, force: isTileForced } });
      lastCollectedTile = { z: tile.z, x: tile.x, y: tile.y };
    }

    const inserted = tileArr.length;

    if (inserted > 0) {
      const first = tileArr[0].data;
      const last = tileArr[inserted - 1].data;
      this.logger.info({
        msg: 'batch tiles range',
        jobId: id,
        batchIndex,
        inserted,
        firstTile: { x: first?.x, y: first?.y, z: first?.z },
        lastTile: { x: last?.x, y: last?.y, z: last?.z },
      });
      await this.populateTilesQueue(tileArr, 'api');
    }

    if (inserted >= this.batchSize) {
      await this.pgboss.send(
        this.requestQueueName,
        { ...job.data, batchIndex: batchIndex + 1, itemIndex, lastTile: lastCollectedTile, totalBatches },
        { ...this.baseQueueConfig, priority }
      );
      this.logger.info({ msg: 'scheduled next batch', jobId: id, itemIndex, nextBatch: batchIndex + 1, totalBatches, lastTile: lastCollectedTile });
    } else if (itemIndex + 1 < items.length) {
      await this.pgboss.send(
        this.requestQueueName,
        { ...job.data, batchIndex: 0, itemIndex: itemIndex + 1, lastTile: undefined, totalBatches },
        { ...this.baseQueueConfig, priority }
      );
      this.logger.info({ msg: 'scheduled next bbox', jobId: id, nextItemIndex: itemIndex + 1 });
    }
  }

  private resolveStartPosition(bbox: BoundingBox, lastTile: LastTile): StartPosition {
    const lowerRight = lonLatZoomToTile({ lon: bbox.east, lat: bbox.south }, lastTile.z, this.metatile);

    if (lastTile.x < lowerRight.x) {
      return { z: lastTile.z, y: lastTile.y, x: lastTile.x + 1 };
    }
    if (lastTile.y < lowerRight.y) {
      return { z: lastTile.z, y: lastTile.y + 1 };
    }
    return { z: lastTile.z + 1 };
  }

  private *generateItemTiles(
    area: BoundingBox | Feature,
    bbox: BoundingBox,
    fromGeojson: boolean,
    start: StartPosition,
    maxZoom: number
  ): Generator<Tile> {
    for (let zoom = start.z; zoom <= maxZoom; zoom++) {
      const upperLeft = lonLatZoomToTile({ lon: bbox.west, lat: bbox.north }, zoom, this.metatile);
      const lowerRight = lonLatZoomToTile({ lon: bbox.east, lat: bbox.south }, zoom, this.metatile);

      const startYAtZoom = zoom === start.z && start.y !== undefined ? start.y : upperLeft.y;

      for (let y = startYAtZoom; y <= lowerRight.y; y++) {
        const startXAtZoom = zoom === start.z && y === start.y && start.x !== undefined ? start.x : upperLeft.x;

        for (let x = startXAtZoom; x <= lowerRight.x; x++) {
          const tile: Tile = { x, y, z: zoom, metatile: this.metatile };

          if (fromGeojson) {
            const tileBbox = tileToBoundingBox(tile);
            if (!booleanIntersects(boundingBoxToPolygon(tileBbox), area as Feature)) {
              continue;
            }
          }

          yield tile;
        }
      }
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

  private computeTotalBatches(items: TileRequestQueuePayload['items']): number {
    let totalTiles = 0;
    for (const item of items) {
      const { bbox, fromGeojson } = areaToBoundingBox(item.area);
      for (const tile of this.generateItemTiles(item.area, bbox, fromGeojson, { z: item.minZoom }, item.maxZoom)) {
        void tile;
        totalTiles++;
      }
    }
    return Math.ceil(totalTiles / this.batchSize);
  }
}
