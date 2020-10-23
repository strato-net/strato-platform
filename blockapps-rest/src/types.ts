
import { OAuthConfig } from "./util/oauth.util";

interface Options {
  config: Config,
  node?:number,
  headers?:any,
  params?:any,
  getFullResponse?:boolean,
  cacheNonce?:any,
  isAsync?: boolean,
  isDetailed?: boolean,
  stateQuery?: any,
  query?: any,
  logger?:Console,
  chainIds?:any,
  history?:any
}

interface Config {
  nodes:Node[],
  apiDebug:boolean,
  VM:string
}  

interface Node {
  url:string,
  oauth:OAuthConfig
}

interface StratoUser {
  password:string,
  username:string,
}

interface BlockChainUser {
  address:string
}

interface OAuthUser {
  token:string
}

interface Contract {
  source:string,
  name:string,
  args:any,
  chainid?:any,
  txParams?:any
}

export { Options, StratoUser, OAuthUser, BlockChainUser, Contract };
