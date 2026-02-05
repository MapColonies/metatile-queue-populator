import 'reflect-metadata';

jest.mock('pg-boss', () => {
  class PgBossMock {}
  return {
    /* eslint-disable @typescript-eslint/naming-convention */
    __esModule: true,
    PgBoss: PgBossMock,
    /* eslint-enable @typescript-eslint/naming-convention */
    default: PgBossMock,
  };
});
