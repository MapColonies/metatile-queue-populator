/* eslint-disable @typescript-eslint/no-magic-numbers */
import { faker } from '@faker-js/faker';

export function getBbox(): [number, number, number, number] {
  const west = faker.datatype.float({ min: -170, max: 170, precision: 0.01 });
  const south = faker.datatype.float({ min: -85, max: 85, precision: 0.01 });
  return [
    west,
    south,
    faker.datatype.float({ min: west + 0.01, max: 171, precision: 0.01 }),
    faker.datatype.float({ min: south + 0.01, max: 86, precision: 0.01 }),
  ];
}
