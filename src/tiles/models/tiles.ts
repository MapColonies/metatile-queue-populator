import { type BoundingBox, type Tile } from '@map-colonies/tile-calc';
import { type Feature, type FeatureCollection } from 'geojson';

interface BaseTilesRequest {
  minZoom: number;
  maxZoom: number;
}

export type BBox = [number, number, number, number];

export interface TilesByAreaRequest<A = BBox | Feature | FeatureCollection> extends BaseTilesRequest {
  area: A;
  priority?: number;
}

export type Source = 'api' | 'expiredTiles';

export interface TileRequestQueuePayloadItem<A = BoundingBox | Feature> extends BaseTilesRequest {
  area: A;
}

export interface BaseQueuePayload {
  state?: number;
  force?: boolean;
}

export type LastTile = Omit<Tile, 'metatile'>;

export interface TileRequestQueuePayload<A = BoundingBox | Feature> extends BaseQueuePayload {
  items: TileRequestQueuePayloadItem<A>[];
  source: Source;
  batchIndex?: number;
  itemIndex?: number;
  priority?: number;
  lastTile?: LastTile;
  totalBatches?: number;
}

export interface TileQueuePayload extends BaseQueuePayload, Tile {
  parent: string;
}

export type ExtendedTile = Tile & BaseQueuePayload;
