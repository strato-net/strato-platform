import { fsUtil } from "blockapps-rest";

let config;

if (!config) {
  const configFilePath = `${process.env.CONFIG_DIR_PATH || '.'}/${
    process.env.ORACLE_MODE === 'true' ? 'oracle_config.yaml' : 'config.yaml'
  }`;
  config = fsUtil.getYaml(configFilePath);
}

export default config;