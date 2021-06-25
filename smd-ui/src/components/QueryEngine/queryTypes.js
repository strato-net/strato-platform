export const TRANSACTION_QUERY_TYPES = {
  default: {
    key: 'default',
    displayName: 'Query Type'
  },
  blocknumber : {
    key: 'blocknumber',
    displayName : 'Block Number'
  },
  hash : {
    key : 'hash',
    displayName : 'Hash'
  },
  to : {
    key: 'to',
    displayName : 'To'
  },
  from : {
    key: 'from',
    displayName : 'From'
  },
  minvalue: {
    key: 'minvalue',
    displayName: 'Min Value'
  },
  maxvalue: {
    key: 'maxvalue',
    displayName: 'Max Value'
  },
  mingasprice: {
    key: 'mingasprice',
    displayName: 'Min Gas Price'
  },
  maxgasprice: {
    key: 'maxgasprice',
    displayName: 'Max Gas Price'
  },
  gaslimit: {
    key: 'gaslimit',
    displayName: 'Gas Limit'
  },
  value : {
    key: 'value',
    displayName : 'Value'
  },
  last : {
    key: 'last',
    displayName : 'Last'
  },
  chainid: {
    key: 'chainid',
    displayName : 'Chain Id'
  }
};

export const BLOCK_QUERY_TYPES = {
  default: {
    key: 'default',
    displayName: 'Query Type'
  },
  number : {
    key: 'number',
    displayName : 'Block Number'
  },
  id : {
    key: 'id',
    displayName : 'Block Id'
  },
  maxnumber : {
    key: 'maxnumber',
    displayName : 'Max Block Number'
  },
  minnumber : {
    key: 'minnumber',
    displayName : 'Min Block Number'
  },
  gaslim: {
    key: 'gaslim',
    displayName: 'Gas Limit'
  },
  mingaslim: {
    key: 'mingaslim',
    displayName: 'Min Gas Limit'
  },
  maxgaslim: {
    key: 'maxgaslim',
    displayName: 'Max Gas Limit'
  },
  gasused : {
    key: 'gasused',
    displayName : 'Gas Used'
  },
  mingasused: {
    key: 'mingasused',
    displayName: 'Min Gas Used'
  },
  maxgasused: {
    key: 'maxgasused',
    displayName: 'Max Gas Used'
  },
  diff: {
    key: 'diff',
    displayName: 'Difficulty'
  },
  maxdiff: {
    key: 'maxdiff',
    displayName: 'Max Difficulty'
  },
  mindiff: {
    key: 'mindiff',
    displayName: 'Min Difficulty'
  },
  txaddress : {
    key: 'txaddress',
    displayName : 'Contained Transaction Address'
  },
  coinbase : {
    key: 'coinbase',
    displayName : 'Coinbase'
  },
  address: {
    key: 'address',
    displayName: 'Address'
  },
  hash : {
    key: 'hash',
    displayName : 'Hash'
  },
  last: {
    key: 'last',
    displayName: 'Last'
  }
};

export const RESOURCE_TYPES = {
  transaction : '/transaction',
  block: '/block'
};
