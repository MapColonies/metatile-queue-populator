import { Tile } from '@map-colonies/tile-calc';
import * as supertest from 'supertest';

export class TilesRequestSender {
  public constructor(private readonly app: Express.Application) {}

  public async postTilesByBboxRequest(bbox: [number, number, number, number], minZoom: number, maxZoom: number): Promise<supertest.Response> {
    return supertest.agent(this.app).post('/tiles/bbox').set('Content-Type', 'application/json').send({ bbox, minZoom, maxZoom });
  }

  public async postTilesList(tiles: Tile[]): Promise<supertest.Response> {
    return supertest.agent(this.app).post('/tiles/list').set('Content-Type', 'application/json').send(tiles);
  }
}
