import { createHash } from 'crypto';
import { BoundingBox } from '@map-colonies/tile-calc';
import PgBoss from 'pg-boss';
import { inject, injectable } from 'tsyringe';
import { PROJECT_NAME_SYMBOL } from '../../common/constants';
import { TileRequestQueuePayload } from './tiles';
import { RequestAlreadyInQueueError } from './errors';
import { TILE_REQUEST_QUEUE_NAME } from './constants';

@injectable()
export class TilesManager {
  private readonly queueName;

  public constructor(private readonly pgboss: PgBoss, @inject(PROJECT_NAME_SYMBOL) projectName: string) {
    this.queueName = `${TILE_REQUEST_QUEUE_NAME}-${projectName}`;
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

    const res = await this.pgboss.sendOnce(this.queueName, payload, {}, hash.digest('hex'));
    if (res === null) {
      throw new RequestAlreadyInQueueError('Request already in queue');
    }
  }
}
