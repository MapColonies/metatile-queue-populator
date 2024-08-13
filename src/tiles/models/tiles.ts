import { BoundingBox, Tile } from '@map-colonies/tile-calc';
import { Feature, FeatureCollection } from '@turf/turf';

interface BaseTilesRequest {
  minZoom: number;
  maxZoom: number;
}

export type BBox = [number, number, number, number];

export interface TilesByAreaRequest<A = BBox | Feature | FeatureCollection> extends BaseTilesRequest {
  area: A;
}

export type Source = 'api' | 'expiredTiles';

export interface TileRequestQueuePayloadItem<A = BoundingBox | Feature> extends BaseTilesRequest {
  area: A;
}

export interface BaseQueuePayload {
  state?: number;
  force?: boolean;
}

export interface TileRequestQueuePayload<A = BoundingBox | Feature> extends BaseQueuePayload {
  items: TileRequestQueuePayloadItem<A>[];
  source: Source;
}

export interface TileQueuePayload extends BaseQueuePayload, Tile {
  parent: string;
}

export type ExtendedTile = Tile & BaseQueuePayload;
