import { ExtendedTile } from '../src/tiles/models/tiles';

declare global {
  namespace jest {
    interface Matchers<R> {
      toContainSameTiles: (expectedTiles: ExtendedTile[]) => CustomMatcherResult;
    }
  }
}
export {};
