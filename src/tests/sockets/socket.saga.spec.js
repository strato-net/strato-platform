import {
  watchCommunicateOverSocket,
  socketSubscribeUnsubscribeRoom,
  readSocketEvents,
  subscribe
} from '../../sockets/socket.saga';
import {
  takeEvery,
  call,
  put,
  fork
} from 'redux-saga/effects';
import {
  subscribeRoom,
  unSubscribeRoom,
  SOCKET_SUBSCRIBE_ROOM,
  SOCKET_UNSUBSCRIBE_ROOM
} from '../../sockets/socket.actions';

import { env } from '../../env'

import { Server, SocketIO } from 'mock-socket';
jest.mock('socket.io-client', () => {
  const { SocketIO } = require('mock-socket');
  return SocketIO;
});

jest.setTimeout(10000); // 10 second timeout

const mockServer = new Server(env.SOCKET_SERVER);

const socket = SocketIO(env.SOCKET_SERVER, { path: '/apex-ws', transports: ['websocket'] })

mockServer.on('connection', server => {
  server.on('SUBSCRIBE/LAST_BLOCK_NUMBER', (data) => {
    setTimeout(() => {
      server.emit('PRELOAD_LAST_BLOCK_NUMBER', 26)
    }, 1000);
  })

  server.on('SUBSCRIBE/USERS_COUNT', (data) => {
    setTimeout(() => {
      server.emit('PRELOAD_USERS_COUNT', 44)
    }, 1000);
  })

  server.on('SUBSCRIBE/CONTRACTS_COUNT', (data) => {
    setTimeout(() => {
      server.emit('PRELOAD_CONTRACTS_COUNT', 14)
    }, 1000);
  })

  server.on('SUBSCRIBE/GET_TRANSACTIONS', (data) => {
    setTimeout(() => {
      server.emit('PRELOAD_GET_TRANSACTIONS', [])
    }, 1000);
  })

  server.on('SUBSCRIBE/BLOCKS_DIFFICULTY', (data) => {
    setTimeout(() => {
      server.emit('PRELOAD_BLOCKS_DIFFICULTY', [])
    }, 1000);
  })

  server.on('SUBSCRIBE/BLOCKS_PROPAGATION', (data) => {
    setTimeout(() => {
      server.emit('PRELOAD_BLOCKS_PROPAGATION', [])
    }, 1000);
  })

  server.on('SUBSCRIBE/TRANSACTIONS_COUNT', (data) => {
    setTimeout(() => {
      server.emit('PRELOAD_TRANSACTIONS_COUNT', 65)
    }, 1000);
  })

  server.on('SUBSCRIBE/TRANSACTIONS_TYPE', (data) => {
    setTimeout(() => {
      server.emit('PRELOAD_TRANSACTIONS_TYPE', {})
    }, 1000);
  })

  server.on('SUBSCRIBE/GET_PEERS', (data) => {
    setTimeout(() => {
      server.emit('PRELOAD_GET_PEERS', {})
    }, 1000);
  })

  server.on('SUBSCRIBE/GET_COINBASE', (data) => {
    setTimeout(() => {
      server.emit('PRELOAD_GET_COINBASE', '831975e62dcaaa8f6d8dc56cf3b4346077799f78')
    }, 1000);
  })

  server.on('SUBSCRIBE/BLOCKS_FREQUENCY', (data) => {
    setTimeout(() => {
      server.emit('PRELOAD_BLOCKS_FREQUENCY', [])
    }, 1000);
  })

});

describe('Test sockets saga', () => {

  test('should watch socket', () => {
    const gen = watchCommunicateOverSocket();
    expect(gen.next().value).toEqual(takeEvery(SOCKET_SUBSCRIBE_ROOM, socketSubscribeUnsubscribeRoom))
    expect(gen.next().value).toEqual(takeEvery(SOCKET_UNSUBSCRIBE_ROOM, socketSubscribeUnsubscribeRoom))
    expect(gen.next().value).toEqual(fork(readSocketEvents))
  })

  test('should subscribe and receive block number', (done) => {

    setTimeout(() => {
      socket.emit('SUBSCRIBE/LAST_BLOCK_NUMBER')
      socket.on('PRELOAD_LAST_BLOCK_NUMBER', (lastblockNumber) => {
        done()
      })
    }, 1000);
  });

  test('should subscribe and receive userCount', (done) => {
    setTimeout(() => {
      socket.emit('SUBSCRIBE/USERS_COUNT')
      socket.on('PRELOAD_USERS_COUNT', (usersCount) => {
        done()
      })
    }, 1000);
  });

  test('should subscribe and receive contracts count', (done) => {
    setTimeout(() => {
      socket.emit('SUBSCRIBE/CONTRACTS_COUNT')
      socket.on('PRELOAD_CONTRACTS_COUNT', (contractsCount) => {
        done()
      })
    }, 1000);
  });

  test('should subscribe and receive transactions', (done) => {
    setTimeout(() => {
      socket.emit('SUBSCRIBE/GET_TRANSACTIONS')
      socket.on('PRELOAD_GET_TRANSACTIONS', (transactions) => {
        done()
      })
    }, 1000);
  });

  test('should subscribe and receive blocks difficulty', (done) => {
    setTimeout(() => {
      socket.emit('SUBSCRIBE/BLOCKS_DIFFICULTY')
      socket.on('PRELOAD_BLOCKS_DIFFICULTY', (blocksDifficulty) => {
        done()
      })
    }, 1000);
  });

  test('should subscribe and receive blocks propagation', (done) => {
    setTimeout(() => {
      socket.emit('SUBSCRIBE/BLOCKS_PROPAGATION')
      socket.on('PRELOAD_BLOCKS_PROPAGATION', (blocksPropagation) => {
        done()
      })
    }, 1000);
  });

  test('should subscribe and receive transaction count', (done) => {
    setTimeout(() => {
      socket.emit('SUBSCRIBE/TRANSACTIONS_COUNT')
      socket.on('PRELOAD_TRANSACTIONS_COUNT', (transactionCount) => {
        done()
      })
    }, 1000);
  });

  test('should subscribe and receive transaction type', (done) => {
    setTimeout(() => {
      socket.emit('SUBSCRIBE/TRANSACTIONS_TYPE')
      socket.on('PRELOAD_TRANSACTIONS_TYPE', (transactionType) => {
        done()
      })
    }, 1000);
  });

  test('should subscribe and receive peers', (done) => {
    setTimeout(() => {
      socket.emit('SUBSCRIBE/GET_PEERS')
      socket.on('PRELOAD_GET_PEERS', (peers) => {
        done()
      })
    }, 1000);
  });

  test('should subscribe and receive coinbase', (done) => {
    setTimeout(() => {
      socket.emit('SUBSCRIBE/GET_COINBASE')
      socket.on('PRELOAD_GET_COINBASE', (coinbase) => {
        done()
      })
    }, 1000);
  });

  test('should subscribe and receive blocks frequency', (done) => {
    setTimeout(() => {
      socket.emit('SUBSCRIBE/BLOCKS_FREQUENCY')
      socket.on('PRELOAD_BLOCKS_FREQUENCY', (blocksFrequency) => {
        done()
      })
    }, 1000);
  });

})

