/* eslint-disable @typescript-eslint/no-magic-numbers */
import { faker } from '@faker-js/faker';
import { BBox } from '@src/tiles/models/tiles';

export function getBbox(): BBox {
  const west = faker.number.float({ min: -170, max: 170, fractionDigits: 2 });
  const south = faker.number.float({ min: -85, max: 85, fractionDigits: 2 });
  return [
    west,
    south,
    faker.number.float({ min: west + 0.01, max: 171, fractionDigits: 2 }),
    faker.number.float({ min: south + 0.01, max: 86, fractionDigits: 2 }),
  ];
}
