import { Router } from 'express';
import { FactoryFunction } from 'tsyringe';
import { TilesController } from '../controllers/tilesController';

export const tilesRouterFactory: FactoryFunction<Router> = (dependencyContainer) => {
  const router = Router();
  const controller = dependencyContainer.resolve(TilesController);

  router.post('/area', controller.postTilesByArea);
  router.post('/list', controller.postTilesList);

  return router;
};

export const TILES_ROUTER = Symbol('tilesRouter');
