import { fsUtil } from 'blockapps-rest'

// eslint-disable-next-line import/no-mutable-exports
const config = fsUtil.getYaml(
  process.env.SERVER
    ? `config/${process.env.SERVER}.config.yaml`
    : `${process.env.CONFIG_DIR_PATH || '.'}/config.yaml`,
)
export default config
