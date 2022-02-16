import { Logger } from '@map-colonies/js-logger';
import { BoundingBox, validateBoundingBox } from '@map-colonies/tile-calc';
import { RequestHandler } from 'express';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { TilesRequest } from '../models/tiles';

import { TilesManager } from '../models/tilesManager';

type PostTilesByBboxHandler = RequestHandler<undefined, {}, TilesRequest>;

@injectable()
export class TilesController {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger, private readonly manager: TilesManager) {}

  public postTilesByBbox: PostTilesByBboxHandler = async (req, res, next) => {
    const bbox: BoundingBox = { west: req.body.bbox[0], south: req.body.bbox[1], east: req.body.bbox[2], north: req.body.bbox[3] };
    validateBoundingBox(bbox);
    if (req.body.minZoom > req.body.maxZoom) {
      return res.status(httpStatus.BAD_REQUEST).send();
    }
    try {
      await this.manager.addTilesRequestToQueue(bbox, req.body.minZoom, req.body.maxZoom);
      return res.status(httpStatus.CREATED).json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  };
}
