import { fsUtil } from 'blockapps-rest'

const config = fsUtil.getYaml(`config/localhost.config.yaml`)

export default config
