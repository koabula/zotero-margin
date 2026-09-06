import type { Config } from './types';
export type ModelConfig = Config & { modelIDs: string[]; defaultModelID: string };
/** Accept the 0.1 configuration without losing its model or credentials. */
export function normalizeConfig(config: Config): ModelConfig {
  const modelIDs = [...new Set((Array.isArray(config.modelIDs) ? config.modelIDs : [config.model])
    .filter(id => typeof id === 'string').map(id => id.trim()).filter(Boolean))];
  const requested = config.defaultModelID || config.model;
  const defaultModelID = modelIDs.includes(requested) ? requested : modelIDs[0] || '';
  return { ...config, model: defaultModelID, modelIDs, defaultModelID };
}
