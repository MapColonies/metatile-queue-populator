import { BoundingBox, Tile } from '@map-colonies/tile-calc';
import { Feature, Polygon, bbox as geojsonToBbox } from '@turf/turf';
import isGeojson from '@turf/boolean-valid';

export const stringifyTile = (tile: Tile): string => {
  return `${tile.z}/${tile.x}/${tile.y}/${tile.metatile as number}`;
};

export const boundingBoxToPolygon = (bbox: BoundingBox): Feature<Polygon> => {
  const { west, south, east, north } = bbox;
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  };
};

export const areaToBoundingBox = (area: BoundingBox | Feature): { bbox: BoundingBox; fromGeojson: boolean } => {
  if (isGeojson(area as Feature)) {
    const bboxArr = geojsonToBbox(area);
    const [west, south, east, north] = bboxArr;
    return { bbox: { west, south, east, north }, fromGeojson: true };
  }

  return { bbox: area as BoundingBox, fromGeojson: false };
};
