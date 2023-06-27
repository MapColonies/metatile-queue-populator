import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@map-colonies/js-logger';
import { BoundingBox, boundingBoxToTiles as boundingBoxToTilesGenerator, Tile, tileToBoundingBox } from '@map-colonies/tile-calc';
import PgBoss from 'pg-boss';
import { inject, Lifecycle, scoped } from 'tsyringe';
import booleanIntersects from '@turf/boolean-intersects';
import { Feature } from '@turf/turf';
import { SERVICES } from '../../common/constants';
import { IConfig, QueueConfig } from '../../common/interfaces';
import { hashValue } from '../../common/util';
import { TileRequestQueuePayload, TilesByAreaRequest } from './tiles';
import { RequestAlreadyInQueueError } from './errors';
import { TILE_REQUEST_QUEUE_NAME, TILES_QUEUE_NAME } from './constants';
import { areaToBoundingBox, boundingBoxToPolygon, stringifyTile } from './util';

@scoped(Lifecycle.ContainerScoped)
export class TilesManager {
  public readonly requestQueueName: string;
  public readonly tilesQueueName: string;
  private readonly batchSize: number;
  private readonly metatile: number;
  private readonly baseQueueConfig: Partial<PgBoss.JobInsert>;

  public constructor(
    private readonly pgboss: PgBoss,
    @inject(SERVICES.CONFIG) config: IConfig,
    @inject(SERVICES.LOGGER) private readonly logger: Logger
  ) {
    const projectName = config.get<string>('app.projectName');
    this.requestQueueName = `${TILE_REQUEST_QUEUE_NAME}-${projectName}`;
    this.tilesQueueName = `${TILES_QUEUE_NAME}-${projectName}`;

    this.batchSize = config.get<number>('app.tilesBatchSize');
    this.metatile = config.get<number>('app.metatileSize');

    const { retryDelaySeconds, ...queueConfig } = config.get<QueueConfig>('queue');
    this.baseQueueConfig = { retryDelay: retryDelaySeconds, ...queueConfig };
    this.logger.info({
      msg: 'queue initialized',
      requestQueueName: this.requestQueueName,
      tilesQueueName: this.tilesQueueName,
      ...this.baseQueueConfig,
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
    await this.pgboss.insert(tileJobsArr);
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

    if (job.data.source === 'api') {
      await this.handleApiTileRequest(job);
    } else {
      await this.handleExpiredTileRequest(job as PgBoss.JobWithDoneCallback<TileRequestQueuePayload<BoundingBox>, void>);
    }
  }

  private async handleApiTileRequest(job: PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>): Promise<void> {
    const { data, id } = job;
    let tileArr: PgBoss.JobInsert[] = [];

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
            await this.pgboss.insert(tileArr);
            tileArr = [];
          }
        }
      }
    }

    if (tileArr.length > 0) {
      await this.pgboss.insert(tileArr);
    }
  }

  private async handleExpiredTileRequest(job: PgBoss.JobWithDoneCallback<TileRequestQueuePayload<BoundingBox>, void>): Promise<void> {
    const { data, id } = job;
    const tileMap = new Map<string, PgBoss.JobInsert>();

    for (const { area, minZoom, maxZoom } of data.items) {
      for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
        const tilesGenerator = boundingBoxToTilesGenerator(area, zoom, this.metatile);
        for await (const tile of tilesGenerator) {
          tileMap.set(stringifyTile(tile), { ...this.baseQueueConfig, name: this.tilesQueueName, data: { ...tile, parent: id } });
          if (tileMap.size >= this.batchSize) {
            await this.pgboss.insert(Array.from(tileMap.values()));
            tileMap.clear();
          }
        }
      }
    }

    if (tileMap.size > 0) {
      await this.pgboss.insert(Array.from(tileMap.values()));
    }
  }
}
