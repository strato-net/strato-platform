export const dashboard = {
  "lastBlockNumber": 9,
  "usersCount": 1,
  "contractsCount": 2,
  "transactionsCount": [
    {
      "x": 0,
      "y": 0
    },
    {
      "x": 1,
      "y": 1
    },
    {
      "x": 2,
      "y": 1
    },
    {
      "x": 3,
      "y": 1
    },
    {
      "x": 4,
      "y": 1
    },
    {
      "x": 5,
      "y": 1
    },
    {
      "x": 6,
      "y": 1
    },
    {
      "x": 7,
      "y": 1
    },
    {
      "x": 8,
      "y": 1
    },
    {
      "x": 9,
      "y": 1
    }
  ],
  "blockPropagation": [
    {
      "x": 0,
      "y": 0
    },
    {
      "x": 1,
      "y": 1512994588
    },
    {
      "x": 2,
      "y": 3358
    },
    {
      "x": 3,
      "y": 19
    },
    {
      "x": 4,
      "y": 1846
    },
    {
      "x": 5,
      "y": 301
    },
    {
      "x": 6,
      "y": 48
    },
    {
      "x": 7,
      "y": 55429
    },
    {
      "x": 8,
      "y": 106195
    },
    {
      "x": 9,
      "y": 58
    }
  ],
  "blockDifficulty": [
    {
      "x": 0,
      "y": 8192
    },
    {
      "x": 1,
      "y": 131072
    },
    {
      "x": 2,
      "y": 131072
    },
    {
      "x": 3,
      "y": 131072
    },
    {
      "x": 4,
      "y": 131072
    },
    {
      "x": 5,
      "y": 131072
    },
    {
      "x": 6,
      "y": 131072
    },
    {
      "x": 7,
      "y": 131072
    },
    {
      "x": 8,
      "y": 131072
    },
    {
      "x": 9,
      "y": 131072
    }
  ],
  "transactionTypes": [
    {
      "val": 6,
      "type": "FunctionCall"
    },
    {
      "val": 1,
      "type": "Transfer"
    },
    {
      "val": 2,
      "type": "Contract"
    }
  ]
};

export const node = {
  "name": "LOCALHOST",
  "peers": {},
  "coinbase": {
    "coinbase": "82069cc441c42b2706fa5d3129deeb677812e5a5"
  }
};

export const nodeWithPeers = {
  "name": "LOCALHOST",
  "peers": {
    '192.168.10.36': {
      tcp_port: "30303",
      pubkey: "687294782948972018571047ra9asd8f97381asdfasd"
    },
    '192.168.10.33':{
      tcp_port: "30303",
      pubkey: "687294782948972018571047ra9asd8f97381asdfasd"
    }
  },
  "coinbase": {
    "coinbase": "82069cc441c42b2706fa5d3129deeb677812e5a5"
  }
};

export const initialState = {
  shardCount: 0,
  lastBlockNumber: 0,
  usersCount: 0,
  contractsCount: 0,
  transactionsCount: [],
  blockPropagation: [],
  blockDifficulty: [],
  transactionTypes: [],
  healthStatus: false,
  uptime: 0
};

export const unSubscribeRoomMock = [
  ['LAST_BLOCK_NUMBER'],
  ['USERS_COUNT'],
  ['CONTRACTS_COUNT'],
  ['BLOCKS_PROPAGATION'],
  ['BLOCKS_FREQUENCY'],
  ['BLOCKS_DIFFICULTY'],
  ['TRANSACTIONS_COUNT'],
  ['TRANSACTIONS_TYPE'],
  ['GET_HEALTH'],
  ['GET_NODE_UPTIME'],
  ['GET_SYSTEM_INFO'],
  ['GET_SHARD_COUNT'],
  ['GET_NETWORK_HEALTH']
]

export const subscribeRoomMock = [
  ['LAST_BLOCK_NUMBER'],
  ['USERS_COUNT'],
  ['CONTRACTS_COUNT'],
  ['BLOCKS_PROPAGATION'],
  ['BLOCKS_FREQUENCY'],
  ['BLOCKS_DIFFICULTY'],
  ['TRANSACTIONS_COUNT'],
  ['TRANSACTIONS_TYPE'],
  ['GET_SHARD_COUNT'],
  ['GET_SYSTEM_INFO'],
  ['GET_NETWORK_HEALTH']
]
