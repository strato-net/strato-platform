import { fsUtil } from 'blockapps-rest';

const config = fsUtil.getYaml(process.env.CONFIG_FILE);

export default config;
