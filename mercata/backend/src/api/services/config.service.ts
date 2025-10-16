import * as config from "../../config/config";
import { ConfigData } from "@mercata/shared-types";

/**
 * Get application configuration to expose to frontend
 */
export const getConfig = (): ConfigData => {
  return {
    wagmiProjectId: config.wagmiProjectId,
  };
};
