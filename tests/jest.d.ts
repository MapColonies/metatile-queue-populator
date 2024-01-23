import { Tile } from '@map-colonies/tile-calc';

declare global {
  namespace jest {
    interface Matchers<R> {
      toContainSameTiles: (expectedTiles: Tile[] & { state?: number }) => CustomMatcherResult;
    }
  }
}
export {};
