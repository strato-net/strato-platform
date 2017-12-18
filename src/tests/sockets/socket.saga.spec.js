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
  fork
} from 'redux-saga/effects';
import {
  subscribeRoom,
  unSubscribeRoom,
  SOCKET_SUBSCRIBE_ROOM,
  SOCKET_UNSUBSCRIBE_ROOM
} from '../../sockets/socket.actions';
import {
  LAST_BLOCK_NUMBER,
  USERS_COUNT,
  CONTRACTS_COUNT,
  GET_TRANSACTIONS,
  BLOCKS_DIFFICULTY,
  BLOCKS_PROPAGATION,
  TRANSACTIONS_COUNT,
  TRANSACTIONS_TYPE,
  GET_PEERS,
  GET_COINBASE,
  BLOCKS_FREQUENCY
} from '../../sockets/rooms';
import { expectSaga } from 'redux-saga-test-plan';
import { env } from '../../env'
import {
  updateBlockNumber,
  preloadBlockNumber,
  updateContractCount,
  preloadContractCount,
  updateUsersCount,
  preloadUsersCount,
  preloadTransactionsCount,
  updateTransactionCount,
  preloadBlockDifficulty,
  updateBlockDifficulty,
  preloadBlockPropagation,
  updateBlockPropagation,
  preloadTransactionType,
  updateTransactionType
} from '../../components/Dashboard/dashboard.action';

import { SocketIO, Server } from 'mock-socket';

jest.mock('socket.io-client', () => {
  const { SocketIO } = require('mock-socket');
  return SocketIO;
});

const mockServer = new Server(env.SOCKET_SERVER, { path: '/apex-ws', transports: ['websocket'] });

describe('Test sockets saga', () => {

  test('should watch socket', () => {
    const gen = watchCommunicateOverSocket();
    expect(gen.next().value).toEqual(takeEvery(SOCKET_SUBSCRIBE_ROOM, socketSubscribeUnsubscribeRoom))
    expect(gen.next().value).toEqual(takeEvery(SOCKET_UNSUBSCRIBE_ROOM, socketSubscribeUnsubscribeRoom))
    expect(gen.next().value).toEqual(fork(readSocketEvents))
  })

  it('should call subscribe socket', (done) => {
    setTimeout(() => {
      expectSaga(readSocketEvents)
        .call.fn(subscribe)
        .run()
      mockServer.stop(done);
    }, 100);
  });

})

