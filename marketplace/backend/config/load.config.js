import { fsUtil } from "blockapps-rest";

let config;

if (!config) {
  const configFilePath = `../config.yaml`;
  config = fsUtil.getYaml(configFilePath);
}

export default config;