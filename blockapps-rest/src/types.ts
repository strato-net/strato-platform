
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
  VM?:string,
  timeout?:number,
  contractsPath?:string
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
  token:string,
  address:string
}

interface OAuthUser {
  token:string
}

interface ContractDefinition {
  source:string,
  name:string,
  args:any,
  chainid?:any,
  txParams?:any
}

interface Contract {
  name: string,
  address?: number,
  src?:string,
  bin?:any,
  codeHash?:any,
  chainId?:any
}

interface TransactionResultHash {
  hash:any
}

interface CallArgs {
  contract: Contract,
  method: any,
  args: any
}

export {
  Options,
  Config,
  StratoUser,
  OAuthUser,
  BlockChainUser,
  Contract,
  ContractDefinition,
  TransactionResultHash,
  CallArgs
};
