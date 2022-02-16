import { createHash } from 'crypto';
import { Logger } from '@map-colonies/js-logger';
import { BoundingBox } from '@map-colonies/tile-calc';
import PgBoss from 'pg-boss';
import { inject, injectable } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { TileRequestQueuePayload } from './tiles';

@injectable()
export class TilesManager {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger, private readonly pgboss: PgBoss) {}

  public async addTilesRequestToQueue(bbox: BoundingBox, minZoom: number, maxZoom: number): Promise<void> {
    const payload: TileRequestQueuePayload = {
      bbox,
      minZoom,
      maxZoom,
      source: 'api',
    };

    const hash = createHash('md5');
    hash.update(JSON.stringify(payload));

    await this.pgboss.sendThrottled('tiles', payload, {}, 25, hash.digest('hex'));
  }
}
