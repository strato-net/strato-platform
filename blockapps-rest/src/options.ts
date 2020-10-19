
interface Options {
  config: {
    nodes:{url:string}[],
    apiDebug:boolean,
  },
  node?:number,
  headers?:any,
  params?:any,
  getFullResponse?:any,
  logger?:Console
}

export { Options };
