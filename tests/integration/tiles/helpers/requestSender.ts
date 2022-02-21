import * as supertest from 'supertest';

export class TilesRequestSender {
  public constructor(private readonly app: Express.Application) {}

  public async postTilesRequest(bbox: [number, number, number, number], minZoom: number, maxZoom: number): Promise<supertest.Response> {
    return supertest.agent(this.app).post('/tiles').set('Content-Type', 'application/json').send({ bbox, minZoom, maxZoom });
  }
}
