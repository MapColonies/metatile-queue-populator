const { initConfig } = require('../../src/common/config');

beforeAll(async () => {
  await initConfig(true);
});
