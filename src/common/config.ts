import { type ConfigInstance, config as loadConfig } from '@map-colonies/config';
import { vectorMetatileQueuePopulatorFullV2, type vectorMetatileQueuePopulatorFullV2Type } from '@map-colonies/schemas';
import nodeConfig from 'config';

// Choose here the type of the config instance and import this type from the entire application
type ConfigType = ConfigInstance<vectorMetatileQueuePopulatorFullV2Type>;

let configInstance: ConfigType | undefined;

/**
 * Initializes the configuration by fetching it from the server.
 * This should only be called from the instrumentation file.
 * @returns A Promise that resolves when the configuration is successfully initialized.
 */
async function initConfig(offlineMode?: boolean): Promise<void> {
  try {
    configInstance = await loadConfig({
      schema: vectorMetatileQueuePopulatorFullV2,
      offlineMode,
    });
  } catch (error) {
    if (offlineMode === true) {
      const get: ConfigType['get'] = (path) => nodeConfig.get(path as string);
      const getAll: ConfigType['getAll'] = () => nodeConfig.util.toObject();
      const getConfigParts: ConfigType['getConfigParts'] = () => ({
        localConfig: nodeConfig.util.toObject(),
        config: {},
        envConfig: {},
      });
      const getResolvedOptions: ConfigType['getResolvedOptions'] = () => ({
        configName: nodeConfig.util.getEnv('CONFIG_NAME') ?? nodeConfig.util.getEnv('NODE_CONFIG_ENV'),
        configServerUrl: nodeConfig.util.getEnv('CONFIG_SERVER_URL'),
        version: nodeConfig.util.getEnv('CONFIG_VERSION'),
        offlineMode: true,
        ignoreServerIsOlderVersionError: nodeConfig.util.getEnv('CONFIG_IGNORE_SERVER_IS_OLDER_VERSION_ERROR'),
      });

      configInstance = {
        get,
        getAll,
        getConfigParts,
        getResolvedOptions,
        initializeMetrics: () => undefined,
      };
      return;
    }

    throw error;
  }
}

function getConfig(): ConfigType {
  if (!configInstance) {
    throw new Error('config not initialized');
  }
  return configInstance;
}

export { getConfig, initConfig };
export type { ConfigType };
