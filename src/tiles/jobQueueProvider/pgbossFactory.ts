import { readFileSync } from 'fs';
import { TlsOptions } from 'tls';
import { hostname } from 'os';
import { vectorMetatileQueuePopulatorFullV1Type } from '@map-colonies/schemas';
import PgBoss from 'pg-boss';
import { SERVICE_NAME } from '@src/common/constants';

type DbConfig = vectorMetatileQueuePopulatorFullV1Type['db'];

const createDatabaseOptions = (dbConfig: DbConfig): PgBoss.ConstructorOptions => {
  let ssl: TlsOptions | undefined = undefined;
  const { ssl: inputSsl, username: user, ...dataSourceOptions } = dbConfig;

  if (inputSsl.enabled) {
    ssl = { key: readFileSync(inputSsl.key), cert: readFileSync(inputSsl.cert), ca: readFileSync(inputSsl.ca) };
  }
  return {
    ...dataSourceOptions,
    user,
    ssl,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    application_name: `${SERVICE_NAME}-${hostname()}-${process.env.NODE_ENV ?? 'unknown_env'}`,
  };
};

export const pgBossFactory = (dbConfig: DbConfig): PgBoss => {
  const databaseOptions = createDatabaseOptions(dbConfig);
  return new PgBoss({ ...databaseOptions, noScheduling: true, noSupervisor: true, uuid: 'v4' });
};

export const PGBOSS_PROVIDER = Symbol('PgBoss');
