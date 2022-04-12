import { readFile } from 'fs/promises';
import PgBoss, { ConstructorOptions, DatabaseOptions } from 'pg-boss';
import { SERVICE_NAME } from './constants';

const createDatabaseOptions = async (dbConfig: DbConfig): Promise<DatabaseOptions> => {
  const { enableSslAuth, sslPaths, ...databaseOptions } = dbConfig;
  databaseOptions.application_name = SERVICE_NAME;
  if (enableSslAuth) {
    databaseOptions.password = undefined;
    const [ca, cert, key] = await Promise.all([readFile(sslPaths.ca), readFile(sslPaths.cert), readFile(sslPaths.key)]);
    databaseOptions.ssl = { key, cert, ca };
  }
  return databaseOptions;
};

export type DbConfig = {
  enableSslAuth: boolean;
  sslPaths: { ca: string; cert: string; key: string };
  certSecretName: string;
} & ConstructorOptions;

export const pgBossFactory = async (dbConfig: DbConfig): Promise<PgBoss> => {
  const databaseOptions = await createDatabaseOptions(dbConfig);
  return new PgBoss({ ...databaseOptions, noScheduling: true, noSupervisor: true, uuid: 'v4' });
};
