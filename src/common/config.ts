import { type ConfigInstance, config } from '@map-colonies/config';
import { vectorMetatileQueuePopulatorFullV2, type vectorMetatileQueuePopulatorFullV2Type } from '@map-colonies/schemas';

// Central alias for the config schema - change the schema version here and it propagates to the entire application
const configSchema = vectorMetatileQueuePopulatorFullV2;
type ConfigSchemaType = vectorMetatileQueuePopulatorFullV2Type;

// Choose here the type of the config instance and import this type from the entire application
type ConfigType = ConfigInstance<ConfigSchemaType>;

let configInstance: ConfigType | undefined;

/**
 * Initializes the configuration by fetching it from the server.
 * This should only be called from the instrumentation file.
 * @returns A Promise that resolves when the configuration is successfully initialized.
 */
async function initConfig(offlineMode?: boolean): Promise<void> {
  configInstance = await config({
    schema: configSchema,
    offlineMode,
  });
}

function getConfig(): ConfigType {
  if (!configInstance) {
    throw new Error('config not initialized');
  }
  return configInstance;
}

export { getConfig, initConfig, configSchema };
export type { ConfigType, ConfigSchemaType };
