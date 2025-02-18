import { readFileSync } from 'fs';
import { TlsOptions } from 'tls';
import { hostname } from 'os';
import { DataSourceOptions } from 'typeorm';
import { vectorMetatileQueuePopulatorV1Type } from '@map-colonies/schemas';

const createDatabaseOptions = async (dbConfig: DbConfig): Promise<DataSourceOptions> => {
  let ssl: TlsOptions | undefined = undefined;
  const { ssl: inputSsl, ...dataSourceOptions } = dbConfig;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  //dataSourceOptions.extra = { application_name: `${hostname()}-${process.env.NODE_ENV ?? 'unknown_env'}` };
  if (inputSsl.enabled) {
    ssl = { key: readFileSync(inputSsl.key), cert: readFileSync(inputSsl.cert), ca: readFileSync(inputSsl.ca) };
  }
  return {
    ...dataSourceOptions,
    type: 'postgres',
    entities: [ '**/models/*.js'],
    ssl,
    applicationName: `${hostname()}-${process.env.NODE_ENV ?? 'unknown_env'}`,
  };
};

export type DbConfig = Pick<vectorMetatileQueuePopulatorV1Type, 'db'>['db'];


export const pgBossFactory = async (dbConfig: DbConfig): Promise<PgBoss> => {
  const databaseOptions = await createDatabaseOptions(dbConfig);
  return new PgBoss({ ...databaseOptions, noScheduling: true, noSupervisor: true, uuid: 'v4' });
};
