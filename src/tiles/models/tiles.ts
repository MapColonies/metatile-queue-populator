import { BoundingBox } from '@map-colonies/tile-calc';
import { Feature, FeatureCollection } from '@turf/turf';

interface BaseTilesRequest {
  minZoom: number;
  maxZoom: number;
}

export type BBox = [number, number, number, number];

export interface TilesByAreaRequest<A = BBox | Feature | FeatureCollection> extends BaseTilesRequest {
  area: A;
}

export interface TileRequestQueuePayloadItem<A = BoundingBox | Feature> extends BaseTilesRequest {
  area: A;
}

export interface TileRequestQueuePayload<A = BoundingBox | Feature> {
  items: TileRequestQueuePayloadItem<A>[];
  source: 'api' | 'expiredTiles';
}
