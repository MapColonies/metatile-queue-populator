import { Tile } from '@map-colonies/tile-calc';

export const parseTile = (tile: string): Tile => {
  const [z, x, y, metatile] = tile.split('/');
  return { z: parseInt(z, 10), x: parseInt(x, 10), y: parseInt(y, 10), metatile: parseInt(metatile, 10) };
};

export const stringifyTile = (tile: Tile): string => {
  return `${tile.z}/${tile.x}/${tile.y}/${tile.metatile ?? 1}`;
};
