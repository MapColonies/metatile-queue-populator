/* eslint-disable @typescript-eslint/no-magic-numbers */
import { BoundingBox } from '@map-colonies/tile-calc';
import { Feature } from '@turf/turf';

export const BBOX1: BoundingBox = { west: 35.20076259970665, south: 31.770502933414285, east: 35.20134598016739, north: 31.77073210500818 };

export const BBOX2: BoundingBox = { west: 35.20076259970665, south: 31.770502933414285, east: 35.21034598016739, north: 31.80173210500818 };

export const BAD_FEATURE: Feature = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-0.703125, 24.84656534821976],
        [11.25, 24.84656534821976],
        [11.25, 22],
        [11.25, 31.353636941500987],
        [-0.703125, 31.353636941500987],
        [-0.703125, 24.84656534821976],
      ],
    ],
  },
};

export const GOOD_FEATURE: Feature = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Point',
    coordinates: [34.771677996274775, 32.084672588143604],
  },
};

export const GOOD_LARGE_FEATURE = {
  type: 'Feature',
  properties: {},
  geometry: {
    coordinates: [
      [
        [34.771474389898145, 32.10290092398452],
        [34.7958478351276, 32.03734236397234],
        [34.801910881204805, 32.03775353581486],
        [34.779598871642236, 32.10238732492981],
        [34.771474389898145, 32.10290092398452],
      ],
    ],
    type: 'Polygon',
  },
};
