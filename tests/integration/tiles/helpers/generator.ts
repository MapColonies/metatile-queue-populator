import { faker } from '@faker-js/faker';

export function getBbox(): [number, number, number, number] {
  const west = faker.datatype.float({ min: -180, max: 180, precision: 2 });
  const south = faker.datatype.float({ min: -90, max: 90, precision: 2 });
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers
  return [west, south, faker.datatype.float({ min: west + 0.01, max: 180, precision: 2 }), faker.datatype.float({ min: south + 0.01, max: 90, precision: 2 })];
}
