import ip from 'ip'
import config from '../load.config'

const { serverIP } = config
const { publicKey } = config.nodes[0]
const port = 30303
const localIp = serverIP || ip.address()

export const getCurrentEnode = () => `enode://${publicKey}@${localIp}:${port}`
export const getCurrentIp = () => `${localIp}`
export const getEnode = (ipAddress) => `enode://${publicKey}@${ipAddress}:${port}`
