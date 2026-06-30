import { randomUUID as uuidv4 } from 'crypto';
import { type Logger } from '@map-colonies/js-logger';
import { BoundingBox, boundingBoxToTiles as boundingBoxToTilesGenerator, Tile, tileToBoundingBox, lonLatZoomToTile } from '@map-colonies/tile-calc';
import { API_STATE } from '@map-colonies/detiler-common';
import { type PgBoss, JobInsert, JobWithMetadata } from 'pg-boss';
import { Pool } from 'pg';
import { inject, injectable } from 'tsyringe';
import client from 'prom-client';
import booleanIntersects from '@turf/boolean-intersects';
import { Feature } from 'geojson';
import { type ConfigType } from '@src/common/config';
import { snakeCase } from 'snake-case';
import { DB_POOL_PROVIDER, SERVICES } from '../../common/constants';
import { JobInsertConfig } from '../../common/interfaces';
import { hashValue } from '../../common/util';
import { PGBOSS_PROVIDER } from '../jobQueueProvider/pgbossFactory';
import { LastTile, Source, TileQueuePayload, TileRequestQueuePayload, TilesByAreaRequest } from './tiles';
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
  private readonly pgBossSchema: string;
  private readonly completedJobsCleanupThreshold: number;

  public constructor(
    @inject(PGBOSS_PROVIDER) private readonly pgboss: PgBoss,
    @inject(SERVICES.CONFIG) config: ConfigType,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(DB_POOL_PROVIDER) private readonly cleanupPool: Pool,
    @inject(SERVICES.METRICS) registry?: client.Registry
  ) {
    const appConfig = config.get('app');
    this.requestQueueName = `${TILE_REQUEST_QUEUE_NAME_PREFIX}-${appConfig.projectName}`;
    this.tilesQueueName = `${TILES_QUEUE_NAME_PREFIX}-${appConfig.projectName}`;
    this.batchSize = appConfig.tilesBatchSize;
    this.metatile = appConfig.metatileSize;
    this.shouldForceApiTiles = appConfig.force.api;
    this.shouldForceExpiredTiles = appConfig.force.expiredTiles;
    this.completedJobsCleanupThreshold = appConfig.completedJobsCleanupThreshold;

    const { retryDelaySeconds, ...queueConfig } = config.get('queue');
    this.baseQueueConfig = { retryDelay: retryDelaySeconds, ...queueConfig };
    this.pgBossSchema = config.get('db').schema;

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
    const singletonSeconds = this.baseQueueConfig.expireInSeconds;

    this.logger.debug({ msg: 'pushing payload to queue', queueName: this.requestQueueName, key, payload, itemCount: payload.items.length });

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const res = await this.pgboss.send(this.requestQueueName, payload, {
      ...this.baseQueueConfig,
      singletonKey: key,
      singletonSeconds,
      priority: priority ?? 0,
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

  private async handleApiTileRequest(job: JobWithMetadata<TileRequestQueuePayload>): Promise<void> {
    const {
      data: { items, state, force, batchIndex = 0, itemIndex = 0, priority },
      id,
    } = job;
    const lastTile = job.data.lastTile;
    const totalBatches = batchIndex === 0 && itemIndex === 0 ? this.computeTotalBatches(items) : job.data.totalBatches;
    const isTileForced = this.shouldForceApiTiles ? this.shouldForceApiTiles : force;
    let inserted = 0;
    let lastCollectedTile: LastTile | undefined;
    const tileArr: JobInsert<TileQueuePayload>[] = [];

    this.logger.debug({ msg: 'handling api tile request batch', jobId: id, itemIndex, batchIndex, lastTile });

    for (const { area, minZoom, maxZoom } of items.slice(itemIndex, itemIndex + 1)) {
      const { bbox: itemBBox, fromGeojson } = areaToBoundingBox(area);

      let startZoom = minZoom;
      let startY: number | undefined;
      let startX: number | undefined;

      if (lastTile) {
        const lowerRight = lonLatZoomToTile({ lon: itemBBox.east, lat: itemBBox.south }, lastTile.z, this.metatile);

        if (lastTile.x < lowerRight.x) {
          startZoom = lastTile.z;
          startY = lastTile.y;
          startX = lastTile.x + 1;
        } else if (lastTile.y < lowerRight.y) {
          startZoom = lastTile.z;
          startY = lastTile.y + 1;
          startX = undefined;
        } else {
          startZoom = lastTile.z + 1;
          startY = undefined;
          startX = undefined;
        }
      }

      this.logger.info({ msg: 'tile generation start', jobId: id, bbox: itemBBox, minZoom, maxZoom, startZoom, startX, startY, fromGeojson });

      outer: for (let zoom = startZoom; zoom <= maxZoom; zoom++) {
        const upperLeft = lonLatZoomToTile({ lon: itemBBox.west, lat: itemBBox.north }, zoom, this.metatile);
        const lowerRight = lonLatZoomToTile({ lon: itemBBox.east, lat: itemBBox.south }, zoom, this.metatile);

        const startYAtZoom = zoom === startZoom && startY !== undefined ? startY : upperLeft.y;

        for (let y = startYAtZoom; y <= lowerRight.y; y++) {
          const startXAtZoom = zoom === startZoom && y === startY && startX !== undefined ? startX : upperLeft.x;

          for (let x = startXAtZoom; x <= lowerRight.x; x++) {
            const tile: Tile = { x, y, z: zoom, metatile: this.metatile };

            if (fromGeojson) {
              const tileBbox = tileToBoundingBox(tile);
              if (!booleanIntersects(boundingBoxToPolygon(tileBbox), area as Feature)) {
                continue;
              }
            }

            if (inserted >= this.batchSize) {
              break outer;
            }

            tileArr.push({ ...this.baseQueueConfig, priority: priority ?? 0, data: { ...tile, parent: id, state, force: isTileForced } });
            lastCollectedTile = { z: zoom, x, y };
            inserted++;
          }
        }
      }

      if (tileArr.length > 0) {
        const first = tileArr[0].data;
        const last = tileArr[tileArr.length - 1].data;
        this.logger.info({
          msg: 'batch tiles range',
          jobId: id,
          batchIndex,
          inserted,
          firstTile: { x: first?.x, y: first?.y, z: first?.z },
          lastTile: { x: last?.x, y: last?.y, z: last?.z },
        });
      }
    }

    if (tileArr.length > 0) {
      await this.populateTilesQueue(tileArr, 'api');
    }
    const jobData = job.data as TileRequestQueuePayload<BoundingBox>;

    if (inserted >= this.batchSize) {
      await this.pgboss.send(
        this.requestQueueName,
        { ...jobData, batchIndex: batchIndex + 1, itemIndex, lastTile: lastCollectedTile, totalBatches },
        { ...this.baseQueueConfig, priority: priority ?? 0 }
      );
      this.logger.info({ msg: 'scheduled next batch', jobId: id, itemIndex, nextBatch: batchIndex + 1, totalBatches, lastTile: lastCollectedTile });
    } else if (itemIndex + 1 < items.length) {
      await this.pgboss.send(
        this.requestQueueName,
        { ...jobData, batchIndex: 0, itemIndex: itemIndex + 1, lastTile: undefined, totalBatches },
        { ...this.baseQueueConfig, priority: priority ?? 0 }
      );
      this.logger.info({ msg: 'scheduled next bbox', jobId: id, nextItemIndex: itemIndex + 1 });
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
    const totalTiles = items.reduce((sum, item) => {
      const { bbox } = areaToBoundingBox(item.area);
      let itemTiles = 0;
      for (let zoom = item.minZoom; zoom <= item.maxZoom; zoom++) {
        const upperLeft = lonLatZoomToTile({ lon: bbox.west, lat: bbox.north }, zoom, this.metatile);
        const lowerRight = lonLatZoomToTile({ lon: bbox.east, lat: bbox.south }, zoom, this.metatile);
        itemTiles += (lowerRight.x - upperLeft.x + 1) * (lowerRight.y - upperLeft.y + 1);
      }
      return sum + itemTiles;
    }, 0);
    return Math.ceil(totalTiles / this.batchSize);
  }

  private async cleanupCompletedTileJobs(): Promise<void> {
    const countResult = await this.cleanupPool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ${this.pgBossSchema}.job WHERE name = $1 AND state = 'completed'`,
      [this.tilesQueueName]
    );
    const completedCount = countResult.rows[0]?.count ?? 0;

    this.logger.debug({ msg: 'completed tile jobs count', completedCount, threshold: this.completedJobsCleanupThreshold });

    if (completedCount >= this.completedJobsCleanupThreshold) {
      const deleteResult = await this.cleanupPool.query(`DELETE FROM ${this.pgBossSchema}.job WHERE name = $1 AND state = 'completed'`, [
        this.tilesQueueName,
      ]);
      this.logger.info({ msg: 'deleted completed tile jobs', deletedCount: deleteResult.rowCount });
    }
  }
}
