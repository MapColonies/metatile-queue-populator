import { Tile } from '@map-colonies/tile-calc';
import * as supertest from 'supertest';
import { TilesByAreaRequest } from '../../../../src/tiles/models/tiles';

export class TilesRequestSender {
  public constructor(private readonly app: Express.Application) {}

  public async postTilesByAreaRequest(request: TilesByAreaRequest | TilesByAreaRequest[], force?: boolean): Promise<supertest.Response> {
    return supertest.agent(this.app).post('/tiles/area').set('Content-Type', 'application/json').send(request).query({ force });
  }

  public async postTilesList(tiles: Tile[], force?: boolean): Promise<supertest.Response> {
    return supertest.agent(this.app).post('/tiles/list').set('Content-Type', 'application/json').send(tiles).query({ force });
  }
}
