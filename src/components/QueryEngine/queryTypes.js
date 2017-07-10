export const TRANSACTION_QUERY_TYPES = {
  blocknumber : {
    key: 'blocknumber',
    displayName : 'Block Number'
  },
  // transactionType : {
  //   key: 'transactiontype',
  //   displayName : 'Transaction Type'
  // },
  // hash : {
  //   key: 'hash',
  //   displayName : 'Hash'
  // },
  to : {
    key: 'to',
    displayName : 'To'
  },
  maxvalue: {
    key: 'maxvalue',
    displayName: 'Max Value'
  },
  minvalue: {
    key: 'minvalue',
    displayName: 'Min Value'
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
  from : {
    key: 'from',
    displayName : 'From'
  },
  last : {
    key: 'last',
    displayName : 'Last'
  }
};

export const RESOURCE_TYPES = {
  transaction : '/transaction',
  block: '/block'
};