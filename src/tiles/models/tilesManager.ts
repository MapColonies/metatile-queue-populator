import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@map-colonies/js-logger';
import { BoundingBox, boundingBoxToTiles, Tile } from '@map-colonies/tile-calc';
import PgBoss from 'pg-boss';
import { inject, Lifecycle, scoped } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { IConfig, QueueConfig } from '../../common/interfaces';
import { TileRequestQueuePayload } from './tiles';
import { RequestAlreadyInQueueError } from './errors';
import { TILE_REQUEST_QUEUE_NAME, TILES_QUEUE_NAME } from './constants';
import { stringifyTile } from './util';

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

  public async addBboxTilesRequestToQueue(bbox: BoundingBox, minZoom: number, maxZoom: number): Promise<void> {
    const payload: TileRequestQueuePayload = {
      bbox: [bbox],
      minZoom,
      maxZoom,
      source: 'api',
    };

    this.logger.debug({ msg: 'pushing payload to queue', queueName: this.requestQueueName, payload });

    const hash = createHash('md5');
    hash.update(JSON.stringify(payload));
    const key = hash.digest('hex');

    const res = await this.pgboss.sendOnce(this.requestQueueName, payload, {}, key);
    if (res === null) {
      this.logger.error({ msg: 'request already in queue', queueName: this.requestQueueName, key, payload });
      throw new RequestAlreadyInQueueError('Request already in queue');
    }
  }

  public async addTilesToQueue(tiles: Tile[]): Promise<void> {
    const id = uuidv4();

    this.logger.debug({ msg: 'inserting tiles to queue', queueName: this.tilesQueueName, parent: id, count: tiles.length });

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
      bboxCount: job.data.bbox.length,
      source: job.data.source,
    });
    this.logger.debug({ msg: 'handling the following tile request', queueName: this.requestQueueName, jobId: job.id, data: job.data });

    if (job.data.source === 'api') {
      await this.handleApiTileRequest(job);
    } else {
      await this.handleExpiredTileRequest(job);
    }
  }

  private async handleExpiredTileRequest(job: PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>): Promise<void> {
    const { data, id } = job;

    const tileMap = new Map<string, PgBoss.JobInsert>();
    for (const bbox of data.bbox) {
      for (let zoom = data.minZoom; zoom <= data.maxZoom; zoom++) {
        const tilesGenerator = boundingBoxToTiles(bbox, zoom, this.metatile);
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

  private async handleApiTileRequest(job: PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>): Promise<void> {
    const { data, id } = job;
    let tileArr: PgBoss.JobInsert[] = [];
    for (const bbox of data.bbox) {
      for (let zoom = data.minZoom; zoom <= data.maxZoom; zoom++) {
        const tilesGenerator = boundingBoxToTiles(bbox, zoom, this.metatile);
        for await (const tile of tilesGenerator) {
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
}
