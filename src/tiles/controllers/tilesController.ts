import { Logger } from '@map-colonies/js-logger';
import { BoundingBox, Tile, validateBoundingBox, validateTile, TILEGRID_WORLD_CRS84 } from '@map-colonies/tile-calc';
import { RequestHandler } from 'express';
import { HttpError } from 'express-openapi-validator/dist/framework/types';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { RequestAlreadyInQueueError } from '../models/errors';
import { TilesByBboxRequest } from '../models/tiles';
import { TilesManager } from '../models/tilesManager';

type PostTilesByBboxHandler = RequestHandler<undefined, { message: string }, TilesByBboxRequest>;
type PostTilesListHandler = RequestHandler<undefined, { message: string }, Tile[]>;

@injectable()
export class TilesController {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger, private readonly manager: TilesManager) {}

  public postTilesByBbox: PostTilesByBboxHandler = async (req, res, next) => {
    const [west, south, east, north] = req.body.bbox;
    const bbox: BoundingBox = { west, south, east, north };
    try {
      validateBoundingBox(bbox);
    } catch (error) {
      (error as HttpError).status = httpStatus.BAD_REQUEST;
      this.logger.error({ msg: 'validation failed', invalidParam: 'bbox', received: bbox, err: error });
      return next(error);
    }

    const { minZoom, maxZoom } = req.body;
    if (minZoom > maxZoom) {
      const error = new Error('minZoom must be less than or equal to maxZoom');
      (error as HttpError).status = httpStatus.BAD_REQUEST;
      this.logger.error({ msg: 'validation failed', invalidParam: ['minZoom', 'maxZoom'], received: { minZoom, maxZoom }, err: error });
      return next(error);
    }

    try {
      await this.manager.addBboxTilesRequestToQueue(bbox, minZoom, maxZoom);
      return res.status(httpStatus.OK).json({ message: httpStatus.getStatusText(httpStatus.OK) });
    } catch (error) {
      if (error instanceof RequestAlreadyInQueueError) {
        (error as HttpError).status = httpStatus.CONFLICT;
      }
      next(error);
    }
  };

  public postTilesList: PostTilesListHandler = async (req, res, next) => {
    const tiles: Tile[] = req.body;
    try {
      tiles.forEach((tile) => validateTile(tile, TILEGRID_WORLD_CRS84));
    } catch (error) {
      (error as HttpError).status = httpStatus.BAD_REQUEST;
      this.logger.error({ msg: 'validation failed', invalidParam: 'tiles', err: error });
      return next(error);
    }

    try {
      await this.manager.addTilesToQueue(tiles);
      return res.status(httpStatus.OK).json({ message: httpStatus.getStatusText(httpStatus.OK) });
    } catch (error) {
      next(error);
    }
  };
}
