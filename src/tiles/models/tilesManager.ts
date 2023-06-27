import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@map-colonies/js-logger';
import { BoundingBox, boundingBoxToTiles as boundingBoxToTilesGenerator, Tile, tileToBoundingBox } from '@map-colonies/tile-calc';
import PgBoss from 'pg-boss';
import { inject, Lifecycle, scoped } from 'tsyringe';
import client from 'prom-client';
import booleanIntersects from '@turf/boolean-intersects';
import { Feature } from '@turf/turf';
import { snakeCase } from 'snake-case';
import { METRICS_REGISTRY, SERVICES } from '../../common/constants';
import { AppConfig, IConfig, QueueConfig } from '../../common/interfaces';
import { hashValue } from '../../common/util';
import { Source, TileRequestQueuePayload, TilesByAreaRequest } from './tiles';
import { RequestAlreadyInQueueError } from './errors';
import { TILE_REQUEST_QUEUE_NAME_PREFIX, TILES_QUEUE_NAME_PREFIX } from './constants';
import { areaToBoundingBox, boundingBoxToPolygon, stringifyTile } from './util';

@scoped(Lifecycle.ContainerScoped)
export class TilesManager {
  public readonly requestQueueName: string;
  public readonly tilesQueueName: string;

  private readonly metatilesPopulatedCounter: client.Counter<'source' | 'z'>;
  private readonly requestsHandledCounter: client.Counter<'source'>;
  private readonly populateHistogram: client.Histogram<'source'>;

  private readonly batchSize: number;
  private readonly metatile: number;
  private readonly baseQueueConfig: Partial<PgBoss.JobInsert>;

  public constructor(
    private readonly pgboss: PgBoss,
    @inject(SERVICES.CONFIG) config: IConfig,
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(METRICS_REGISTRY) registry: client.Registry
  ) {
    const appConfig = config.get<AppConfig>('app');
    this.requestQueueName = `${TILE_REQUEST_QUEUE_NAME_PREFIX}-${appConfig.projectName}`;
    this.tilesQueueName = `${TILES_QUEUE_NAME_PREFIX}-${appConfig.projectName}`;
    this.batchSize = appConfig.tilesBatchSize;
    this.metatile = appConfig.metatileSize;

    const { retryDelaySeconds, ...queueConfig } = config.get<QueueConfig>('queue');
    this.baseQueueConfig = { retryDelay: retryDelaySeconds, ...queueConfig };

    this.logger.info({
      msg: 'queue initialized',
      requestQueueName: this.requestQueueName,
      tilesQueueName: this.tilesQueueName,
      ...this.baseQueueConfig,
    });

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
          const currentQueueSize = await self.pgboss.getQueueSize(queue.name);
          this.set(currentQueueSize);
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
      labelNames: ['source'] as const,
      registers: [registry],
    });

    this.populateHistogram = new client.Histogram({
      name: 'metatile_queue_populator_population_seconds',
      help: 'metatile-queue-populator population duration by source',
      buckets: config.get<number[]>('telemetry.metrics.buckets'),
      labelNames: ['source'] as const,
      registers: [registry],
    });
  }

  public async addArealTilesRequestToQueue(request: TilesByAreaRequest[]): Promise<void> {
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
    };

    const key = hashValue(payload);

    this.logger.debug({ msg: 'pushing payload to queue', queueName: this.requestQueueName, key, payload, itemCount: payload.items.length });

    const res = await this.pgboss.sendOnce(this.requestQueueName, payload, {}, key);

    if (res === null) {
      this.logger.error({ msg: 'request already in queue', queueName: this.requestQueueName, key, payload });
      throw new RequestAlreadyInQueueError('Request already in queue');
    }
  }

  public async addTilesToQueue(tiles: Tile[]): Promise<void> {
    const id = uuidv4();

    this.logger.debug({ msg: 'inserting tiles to queue', queueName: this.tilesQueueName, parent: id, itemCount: tiles.length });

    const tileJobsArr = tiles.map((tile) => ({ ...this.baseQueueConfig, name: this.tilesQueueName, data: { ...tile, parent: id } }));
    await this.populateTilesQueue(tileJobsArr, 'api');
  }

  public async isAlive(): Promise<void> {
    await this.pgboss.getQueueSize(this.requestQueueName);
  }

  public async handleTileRequest(job: PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>): Promise<void> {
    this.logger.info({
      msg: 'handling tile request',
      queueName: this.requestQueueName,
      jobId: job.id,
      itemCount: job.data.items.length,
      source: job.data.source,
    });

    this.logger.debug({ msg: 'handling the following tile request', queueName: this.requestQueueName, jobId: job.id, data: job.data });

    const fetchTimerEnd = this.populateHistogram.startTimer({ source: job.data.source });

    if (job.data.source === 'api') {
      await this.handleApiTileRequest(job);
    } else {
      await this.handleExpiredTileRequest(job as PgBoss.JobWithDoneCallback<TileRequestQueuePayload<BoundingBox>, void>);
    }

    fetchTimerEnd();
    this.requestsHandledCounter.inc({ source: job.data.source });
  }

  private async handleApiTileRequest(job: PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>): Promise<void> {
    const { data, id } = job;
    let tileArr: PgBoss.JobInsert<Tile & { parent: string }>[] = [];

    for (const { area, minZoom, maxZoom } of data.items) {
      const { bbox: itemBBox, fromGeojson } = areaToBoundingBox(area);

      for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
        for await (const tile of boundingBoxToTilesGenerator(itemBBox, zoom, this.metatile)) {
          if (fromGeojson) {
            const tileBbox = tileToBoundingBox(tile);
            if (!booleanIntersects(boundingBoxToPolygon(tileBbox), area as Feature)) {
              continue;
            }
          }

          tileArr.push({ ...this.baseQueueConfig, name: this.tilesQueueName, data: { ...tile, parent: id } });
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

  private async handleExpiredTileRequest(job: PgBoss.JobWithDoneCallback<TileRequestQueuePayload<BoundingBox>, void>): Promise<void> {
    const { data, id } = job;
    const tileMap = new Map<string, PgBoss.JobInsert<Tile & { parent: string }>>();

    for (const { area, minZoom, maxZoom } of data.items) {
      for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
        const tilesGenerator = boundingBoxToTilesGenerator(area, zoom, this.metatile);
        for await (const tile of tilesGenerator) {
          tileMap.set(stringifyTile(tile), { ...this.baseQueueConfig, name: this.tilesQueueName, data: { ...tile, parent: id } });
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

  private async populateTilesQueue(tiles: PgBoss.JobInsert<Tile & { parent: string }>[], source: Source): Promise<void> {
    await this.pgboss.insert(tiles);
    tiles.forEach((tile) => this.metatilesPopulatedCounter.inc({ source, z: tile.data?.z }));
  }
}
