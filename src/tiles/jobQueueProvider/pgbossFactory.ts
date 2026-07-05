import { readFileSync } from 'fs';
import { TlsOptions } from 'tls';
import { hostname } from 'os';
import { PgBoss, type ConstructorOptions } from 'pg-boss';
import { SERVICE_NAME } from '@src/common/constants';
import { type ConfigSchemaType } from '@src/common/config';

type DbConfig = ConfigSchemaType['db'];

const createDatabaseOptions = (dbConfig: DbConfig): ConstructorOptions => {
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
  return new PgBoss({
    ...databaseOptions,
  });
};

export const PGBOSS_PROVIDER = Symbol('PgBoss');
