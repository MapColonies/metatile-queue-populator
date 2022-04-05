import { BoundingBox } from '@map-colonies/tile-calc';

export interface TilesByBboxRequest {
  bbox: [number, number, number, number];
  minZoom: number;
  maxZoom: number;
}

export interface TileRequestQueuePayload {
  bbox: BoundingBox[];
  minZoom: number;
  maxZoom: number;
  source: 'api' | 'expiredTiles';
}
