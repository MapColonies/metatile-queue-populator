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
