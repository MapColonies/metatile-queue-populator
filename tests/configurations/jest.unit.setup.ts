import 'reflect-metadata';

jest.mock('pg-boss', () => {
  class PgBossMock {}
  return {
    __esModule: true,
    PgBoss: PgBossMock,
    default: PgBossMock,
  };
});
