import { type Logger } from '@map-colonies/js-logger';
import { HttpError } from '@map-colonies/error-express-handler';
import { Tile, validateBoundingBox, validateTile, TILEGRID_WORLD_CRS84 } from '@map-colonies/tile-calc';
import geojsonValidator from '@turf/boolean-valid';
import { RequestHandler } from 'express';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { RequestValidationError } from '../models/errors';
import { TilesByAreaRequest } from '../models/tiles';
import { TilesManager } from '../models/tilesManager';

type PostTilesByAreaHandler = RequestHandler<undefined, { message: string }, TilesByAreaRequest | TilesByAreaRequest[], { force?: boolean }>;
type PostTilesListHandler = RequestHandler<undefined, { message: string }, Tile[], { force?: boolean }>;

@injectable()
export class TilesController {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(TilesManager) private readonly manager: TilesManager
  ) {}

  public postTilesByArea: PostTilesByAreaHandler = async (req, res, next) => {
    const arealRequest = Array.isArray(req.body) ? req.body : [req.body];
    try {
      this.validateRequest(arealRequest);
      await this.manager.addArealTilesRequestToQueue(arealRequest, req.query.force);
      return res.status(httpStatus.OK).json({ message: httpStatus.getStatusText(httpStatus.OK) });
    } catch (error) {
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
      await this.manager.addTilesToQueue(tiles, req.query.force);
      return res.status(httpStatus.OK).json({ message: httpStatus.getStatusText(httpStatus.OK) });
    } catch (error) {
      next(error);
    }
  };

  private validateRequest(request: TilesByAreaRequest[]): void {
    for (const { area, minZoom, maxZoom } of request) {
      if (minZoom > maxZoom) {
        const error = new RequestValidationError('minZoom must be less than or equal to maxZoom');
        this.logger.error({ msg: 'validation failed', invalidParam: ['minZoom', 'maxZoom'], received: { minZoom, maxZoom }, err: error });
        throw error;
      }

      if (Array.isArray(area)) {
        try {
          const [west, south, east, north] = area;
          validateBoundingBox({ west, south, east, north });
          continue;
        } catch (error) {
          this.logger.error({ msg: 'validation failed', invalidParam: 'area', received: area, err: error });
          throw new RequestValidationError((error as Error).message);
        }
      }

      const geojsons = area.type === 'FeatureCollection' ? area.features : [area];

      for (const geojson of geojsons) {
        if (!geojsonValidator(geojson)) {
          const error = new RequestValidationError('area is an invalid geojson');
          this.logger.error({ msg: 'validation failed', invalidParam: 'area', received: area, err: error });
          throw error;
        }
      }
    }
  }
}
