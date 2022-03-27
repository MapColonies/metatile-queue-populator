const lodash = require('lodash');
const { stringifyTile } = require('../src/tiles/models/util');

expect.extend({
  toContainSameTiles(actual, expected) {
    const actualStringified = actual.map(stringifyTile).sort();
    const expectedStringified = expected.map(stringifyTile).sort();
    const pass = lodash.isEqual(actualStringified, expectedStringified);
    const message = () => `expected ${JSON.stringify(actual)} to contain the same tiles as ${JSON.stringify(expected)}`;
    return { pass, message };
  },
});
