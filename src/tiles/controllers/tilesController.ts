import { Logger } from '@map-colonies/js-logger';
import { BoundingBox, validateBoundingBox } from '@map-colonies/tile-calc';
import { RequestHandler } from 'express';
import { HttpError } from 'express-openapi-validator/dist/framework/types';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { RequestAlreadyInQueueError } from '../models/errors';
import { TilesRequest } from '../models/tiles';

import { TilesManager } from '../models/tilesManager';

type PostTilesByBboxHandler = RequestHandler<undefined, { message: string }, TilesRequest>;

@injectable()
export class TilesController {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger, private readonly manager: TilesManager) {}

  public postTilesByBbox: PostTilesByBboxHandler = async (req, res, next) => {
    const bbox: BoundingBox = { west: req.body.bbox[0], south: req.body.bbox[1], east: req.body.bbox[2], north: req.body.bbox[3] };

    try {
      validateBoundingBox(bbox);
    } catch (error) {
      (error as HttpError).status = httpStatus.BAD_REQUEST;
      return next(error);
    }

    if (req.body.minZoom > req.body.maxZoom) {
      const error = new Error('minZoom must be less than or equal to maxZoom');
      (error as HttpError).status = httpStatus.BAD_REQUEST;
      return next(error);
    }

    try {
      await this.manager.addTilesRequestToQueue(bbox, req.body.minZoom, req.body.maxZoom);
      return res.status(httpStatus.OK).json({ message: httpStatus.getStatusText(httpStatus.OK) });
    } catch (error) {
      if (error instanceof RequestAlreadyInQueueError) {
        (error as HttpError).status = httpStatus.CONFLICT;
      }

      next(error);
    }
  };
}
