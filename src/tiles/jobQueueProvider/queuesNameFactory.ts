import { ConfigType } from '@src/common/config';
import { SERVICES } from '@src/common/constants';
import { FactoryFunction } from 'tsyringe';
import { TILE_REQUEST_QUEUE_NAME_PREFIX, TILES_QUEUE_NAME_PREFIX } from '../models/constants';

export interface QueuesName {
  requestQueue: string;
  tilesQueue: string;
}

export const queuesNameFactory: FactoryFunction<{ requestQueue: string; tilesQueue: string }> = (container) => {
  const appConfig = container.resolve<ConfigType>(SERVICES.CONFIG).get('app');

  const requestQueue = `${TILE_REQUEST_QUEUE_NAME_PREFIX}-${appConfig.projectName}`;
  const tilesQueue = `${TILES_QUEUE_NAME_PREFIX}-${appConfig.projectName}`;

  return { requestQueue, tilesQueue };
};
