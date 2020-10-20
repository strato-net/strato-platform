
interface Options {
  config: Config,
  node?:number,
  headers?:any,
  params?:any,
  getFullResponse?:any,
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
  nodes:{url:string}[],
  apiDebug:boolean,
  VM:string
}  

export { Options };
