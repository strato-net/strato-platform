import { fsUtil } from "blockapps-rest";

let deploy;

if (!deploy) {
  try {
    deploy = fsUtil.getYaml(
      `${process.env.CONFIG_DIR_PATH || './config'}/deploy.yaml`,
    );
  } catch (e) {
    console.log('Loading deploy.yaml failed', JSON.stringify(e))
    deploy = {
      contracts: {
        stripe: {},
        metamask: {},
        redemption: {}
      }
    }
  }
}

export default deploy;