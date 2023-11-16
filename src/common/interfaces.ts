export interface IConfig {
  get: <T>(setting: string) => T;
  has: (setting: string) => boolean;
}

export interface OpenApiConfig {
  filePath: string;
  basePath: string;
  jsonPath: string;
  uiPath: string;
}

export interface QueueConfig {
  expireInSeconds: number;
  retryBackoff: boolean;
  retryLimit: number;
  retryDelaySeconds: number;
  retentionHours: number;
}

export interface JobInsertConfig extends Partial<Omit<QueueConfig, 'retryDelaySeconds'>> {
  retryDelay?: number;
}

export interface AppConfig {
  projectName: string;
  enableRequestQueueHandling: boolean;
  requestQueueCheckIntervalSec: number;
  tilesBatchSize: number;
  metatileSize: number;
  consumeDelay: {
    enabled: boolean;
    delaySec: number;
    tilesQueueSizeLimit: number;
  };
}
