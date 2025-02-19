import { readFileSync } from 'fs';
import { TlsOptions } from 'tls';
import { hostname } from 'os';
import { vectorMetatileQueuePopulatorV1Type } from '@map-colonies/schemas';
import PgBoss from 'pg-boss';

const createDatabaseOptions = (dbConfig: DbConfig): PgBoss.ConstructorOptions => {
  let ssl: TlsOptions | undefined = undefined;
  const { ssl: inputSsl, ...dataSourceOptions } = dbConfig;

  if (inputSsl.enabled) {
    ssl = { key: readFileSync(inputSsl.key), cert: readFileSync(inputSsl.cert), ca: readFileSync(inputSsl.ca) };
  }
  return {
    ...dataSourceOptions,
    user: dataSourceOptions.username,
    ssl,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    application_name: `${hostname()}-${process.env.NODE_ENV ?? 'unknown_env'}`,
  };
};

export type DbConfig = Pick<vectorMetatileQueuePopulatorV1Type, 'db'>['db'];

export const pgBossFactory = (dbConfig: DbConfig): PgBoss => {
  const databaseOptions = createDatabaseOptions(dbConfig);
  return new PgBoss({ ...databaseOptions, noScheduling: true, noSupervisor: true, uuid: 'v4' });
};
