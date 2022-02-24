import { createHash } from 'crypto';
import { Logger } from '@map-colonies/js-logger'
import { BoundingBox, boundingBoxToTiles, Tile } from '@map-colonies/tile-calc';
import PgBoss from 'pg-boss';
import { inject, singleton } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { IConfig } from '../../common/interfaces';
import { TileRequestQueuePayload } from './tiles';
import { RequestAlreadyInQueueError } from './errors';
import { TILE_REQUEST_QUEUE_NAME, TILES_QUEUE_NAME } from './constants';
import { stringifyTile } from './util';

@singleton()
export class TilesManager {
  public readonly requestQueueName: string;
  public readonly tilesQueueName: string;
  private readonly batchSize: number;
  private readonly metatile: number;

  public constructor(private readonly pgboss: PgBoss, @inject(SERVICES.CONFIG) config: IConfig, @inject(SERVICES.LOGGER) private readonly logger: Logger) {
    const projectName = config.get<string>('app.projectName');
    this.requestQueueName = `${TILE_REQUEST_QUEUE_NAME}-${projectName}`;
    this.tilesQueueName = `${TILES_QUEUE_NAME}-${projectName}`;

    this.batchSize = config.get<number>('app.tilesBatchSize');
    this.metatile = config.get<number>('app.metatileSize');
  }

  public async addTilesRequestToQueue(bbox: BoundingBox, minZoom: number, maxZoom: number): Promise<void> {
    const payload: TileRequestQueuePayload = {
      bbox: [bbox],
      minZoom,
      maxZoom,
      source: 'api',
    };

    const hash = createHash('md5');
    hash.update(JSON.stringify(payload));

    const res = await this.pgboss.sendOnce(this.requestQueueName, payload, {}, hash.digest('hex'));
    if (res === null) {
      throw new RequestAlreadyInQueueError('Request already in queue');
    }
  }

  public async isAlive(): Promise<void> {
    await this.pgboss.getQueueSize(this.requestQueueName);
  }

  public async handleTileRequest(job: PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>): Promise<void> {
    const data = job.data;
    this.logger.info(`Handling tile request for ${data.bbox.length} bounding boxes with source ${data.source}`);
    this.logger.debug(`request payload: ${JSON.stringify(data)}`);

    if (data.source === 'api') {
      await this.handleApiTileRequest(data);
    } else {
      await this.handleExpiredTileRequest(data);
    }
  }

  private async handleExpiredTileRequest(payload: TileRequestQueuePayload): Promise<void> {
    const tileMap = new Map<string, PgBoss.JobInsert>();
    for (const bbox of payload.bbox) {
      for (let zoom = payload.minZoom; zoom <= payload.maxZoom; zoom++) {
        const tilesGenerator = boundingBoxToTiles(bbox, zoom, this.metatile);
        for await (const tile of tilesGenerator) {
          tileMap.set(stringifyTile(tile), { name: this.tilesQueueName, data: tile });
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

  private async handleApiTileRequest(payload: TileRequestQueuePayload): Promise<void> {
    let tileArr: PgBoss.JobInsert[] = [];
    for (const bbox of payload.bbox) {
      for (let zoom = payload.minZoom; zoom <= payload.maxZoom; zoom++) {
        const tilesGenerator = boundingBoxToTiles(bbox, zoom, this.metatile);
        for await (const tile of tilesGenerator) {
          tileArr.push({ name: this.tilesQueueName, data: tile });
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
