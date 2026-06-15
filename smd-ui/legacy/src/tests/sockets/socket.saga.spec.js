import {
  watchCommunicateOverSocket,
  socketSubscribeUnsubscribeRoom,
  readSocketEvents,
  subscribe,
  registerActions
} from '../../sockets/socket.saga';
import {
  takeEvery,
  call,
  put,
  fork,
  take
} from 'redux-saga/effects';
import { eventChannel } from 'redux-saga';
import {
  subscribeRoom,
  unSubscribeRoom,
  SOCKET_SUBSCRIBE_ROOM,
  SOCKET_UNSUBSCRIBE_ROOM
} from '../../sockets/socket.actions';
import {
  updateBlockNumber,
  preloadBlockNumber
} from '../../components/Dashboard/dashboard.action';
import { env } from '../../env'
import { Server, SocketIO } from 'mock-socket';

jest.mock('socket.io-client', () => {
  const { SocketIO } = require('mock-socket');
  return SocketIO;
});

jest.setTimeout(10000); // 10 second timeout

var mockServer = new Server(env.SOCKET_SERVER);

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

  server.on('SUBSCRIBE/GET_HEALTH', (data) => {
    setTimeout(() => {
      server.emit('PRELOAD_HEALTH', {})
    }, 1000);
  })

  server.on('SUBSCRIBE/GET_NODE_UPTIME', (data) => {
    setTimeout(() => {
      server.emit('PRELOAD_NODE_UPTIME', 0)
    }, 1000);
  })

  server.on('SUBSCRIBE/GET_NETWORK_HEALTH', (data) => {
    setTimeout(() => {
      server.emit('PRELOAD_NETWORK_HEALTH', true)
    }, 1000);
  })

  server.on('SUBSCRIBE/GET_SHARD_COUNT', (data) => {
    setTimeout(() => {
      server.emit('PRELOAD_GET_SHARD_COUNT', 0)
    }, 1000);
  })

});

const channel = () => { }
const action = {}
describe('Socket: saga', () => {

  afterAll(() => {
    mockServer.close()
  });

  test('watch socket', () => {
    const gen = watchCommunicateOverSocket();
    expect(gen.next().value).toEqual(takeEvery(SOCKET_SUBSCRIBE_ROOM, socketSubscribeUnsubscribeRoom))
    expect(gen.next().value).toEqual(takeEvery(SOCKET_UNSUBSCRIBE_ROOM, socketSubscribeUnsubscribeRoom))
    expect(gen.next().value).toEqual(fork(readSocketEvents))
  })

  test('readsocket events', () => {
    const gen = readSocketEvents()
    expect(gen.next().value).toEqual(call(subscribe))
    expect(gen.next(channel).value).toEqual(take(channel))
    expect(gen.next(action).value).toEqual(put(action))
  })

  test('subscribe events', () => {
    expect(subscribe()).toMatchSnapshot()
  })

  test('suscribeUnsubscribe room', (done) => {
    const gen = socketSubscribeUnsubscribeRoom('test')
    setTimeout(() => {
      done()
      expect(gen.next().value).toBeCalled()
    }, 1000);
  })

  describe('subscribe and receive', () => {

    test('block number', (done) => {

      setTimeout(() => {
        socket.emit('SUBSCRIBE/LAST_BLOCK_NUMBER')
        socket.on('PRELOAD_LAST_BLOCK_NUMBER', (lastblockNumber) => {
          done()
        })
      }, 1000);
    });

    test('userCount', (done) => {
      setTimeout(() => {
        socket.emit('SUBSCRIBE/USERS_COUNT')
        socket.on('PRELOAD_USERS_COUNT', (usersCount) => {
          done()
        })
      }, 1000);
    });

    test('contracts count', (done) => {
      setTimeout(() => {
        socket.emit('SUBSCRIBE/CONTRACTS_COUNT')
        socket.on('PRELOAD_CONTRACTS_COUNT', (contractsCount) => {
          done()
        })
      }, 1000);
    });

    test('transactions', (done) => {
      setTimeout(() => {
        socket.emit('SUBSCRIBE/GET_TRANSACTIONS')
        socket.on('PRELOAD_GET_TRANSACTIONS', (transactions) => {
          done()
        })
      }, 1000);
    });

    test('blocks difficulty', (done) => {
      setTimeout(() => {
        socket.emit('SUBSCRIBE/BLOCKS_DIFFICULTY')
        socket.on('PRELOAD_BLOCKS_DIFFICULTY', (blocksDifficulty) => {
          done()
        })
      }, 1000);
    });

    test('blocks propagation', (done) => {
      setTimeout(() => {
        socket.emit('SUBSCRIBE/BLOCKS_PROPAGATION')
        socket.on('PRELOAD_BLOCKS_PROPAGATION', (blocksPropagation) => {
          done()
        })
      }, 1000);
    });

    test('transaction count', (done) => {
      setTimeout(() => {
        socket.emit('SUBSCRIBE/TRANSACTIONS_COUNT')
        socket.on('PRELOAD_TRANSACTIONS_COUNT', (transactionCount) => {
          done()
        })
      }, 1000);
    });

    test('transaction type', (done) => {
      setTimeout(() => {
        socket.emit('SUBSCRIBE/TRANSACTIONS_TYPE')
        socket.on('PRELOAD_TRANSACTIONS_TYPE', (transactionType) => {
          done()
        })
      }, 1000);
    });

    test('peers', (done) => {
      setTimeout(() => {
        socket.emit('SUBSCRIBE/GET_PEERS')
        socket.on('PRELOAD_GET_PEERS', (peers) => {
          done()
        })
      }, 1000);
    });

    test('coinbase', (done) => {
      setTimeout(() => {
        socket.emit('SUBSCRIBE/GET_COINBASE')
        socket.on('PRELOAD_GET_COINBASE', (coinbase) => {
          done()
        })
      }, 1000);
    });

    test('blocks frequency', (done) => {
      setTimeout(() => {
        socket.emit('SUBSCRIBE/BLOCKS_FREQUENCY')
        socket.on('PRELOAD_BLOCKS_FREQUENCY', (blocksFrequency) => {
          done()
        })
      }, 1000);
    });

    test('health', (done) => {
      setTimeout(() => {
        socket.emit('SUBSCRIBE/GET_HEALTH')
        socket.on('PRELOAD_HEALTH', (health) => {
          done()
        })
      }, 1000);
    });

    test('node uptime', (done) => {
      setTimeout(() => {
        socket.emit('SUBSCRIBE/GET_NODE_UPTIME')
        socket.on('PRELOAD_NODE_UPTIME', (uptime) => {
          done()
        })
      }, 1000);
    });

    test('shards count', (done) => {
      setTimeout(() => {
        socket.emit('SUBSCRIBE/GET_SHARD_COUNT')
        socket.on('PRELOAD_GET_SHARD_COUNT', (count) => {
          done()
        })
      }, 1000);
    });

  })

})

