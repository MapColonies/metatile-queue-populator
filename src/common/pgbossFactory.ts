import { readFile } from 'fs/promises';
import PgBoss, { DatabaseOptions } from 'pg-boss';

const createDatabaseOptions = async (dbConfig: DbConfig): Promise<DatabaseOptions> => {
  const { enableSslAuth, sslPaths, ...databaseOptions } = dbConfig;
  if (enableSslAuth) {
    databaseOptions.password = undefined;
    const [ca, cert, key] = await Promise.all([readFile(sslPaths.ca), readFile(sslPaths.cert), readFile(sslPaths.key)]);
    databaseOptions.ssl = { key: key, cert: cert, ca: ca };
  }
  return databaseOptions;
};

export type DbConfig = {
  enableSslAuth: boolean;
  sslPaths: { ca: string; cert: string; key: string };
  certSecretName: string;
} & DatabaseOptions;

export const pgBossFactory = async (dbConfig: DbConfig): Promise<PgBoss> => {
  const databaseOptions = await createDatabaseOptions(dbConfig);
  return new PgBoss({ ...databaseOptions });
};
