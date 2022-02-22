import { createHash } from 'crypto';
import { BoundingBox, boundingBoxToTiles, Tile } from '@map-colonies/tile-calc';
import PgBoss from 'pg-boss';
import { inject, singleton } from 'tsyringe';
import { PROJECT_NAME_SYMBOL } from '../../common/constants';
import { TileRequestQueuePayload } from './tiles';
import { RequestAlreadyInQueueError } from './errors';
import { TILE_REQUEST_QUEUE_NAME, TILES_QUEUE_NAME } from './constants';
import { stringifyTile } from './util';

@singleton()
export class TilesManager {
  public readonly requestQueueName;
  public readonly tilesQueueName: string;

  public constructor(private readonly pgboss: PgBoss, @inject(PROJECT_NAME_SYMBOL) projectName: string) {
    this.requestQueueName = `${TILE_REQUEST_QUEUE_NAME}-${projectName}`;
    this.tilesQueueName = `${TILES_QUEUE_NAME}-${projectName}`;
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

  public async handleTileRequest(job: PgBoss.JobWithDoneCallback<TileRequestQueuePayload, void>): Promise<void> {
    const data = job.data;
    const tileMap = new Map<string, Tile>();
    for (const bbox of data.bbox) {
      for (let zoom = data.minZoom; zoom <= data.maxZoom; zoom++) {
        const tilesGenerator = boundingBoxToTiles(bbox, zoom, 8);
        for await (const tile of tilesGenerator) {
          tileMap.set(stringifyTile(tile), tile);
          if (tileMap.size > 10000) {
            const jobs = Array.from(tileMap.values()).map((tile) => ({ name: this.tilesQueueName, data: tile }));
            await this.pgboss.insert(jobs);
            tileMap.clear();
          }
        }
      }
    }
    if (tileMap.size > 0) {
      const jobs = Array.from(tileMap.values()).map((tile) => ({ name: this.tilesQueueName, data: tile }));
      await this.pgboss.insert(jobs);
    }
  }
}
