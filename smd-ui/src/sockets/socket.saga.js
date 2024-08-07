import io from 'socket.io-client';
import {
  put,
  call,
  take,
  fork,
  takeEvery
} from 'redux-saga/effects';
import { eventChannel } from 'redux-saga';
import { SOCKET_SUBSCRIBE_ROOM, SOCKET_UNSUBSCRIBE_ROOM } from './socket.actions';
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
  GET_HEALTH,
  GET_NODE_UPTIME,
  GET_SYSTEM_INFO,
  GET_SHARD_COUNT,
  GET_NETWORK_HEALTH,
} from './rooms';
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
  updateTransactionType,
  preloadHealth,
  updateHealth,
  preloadNodeUptime,
  updateNodeUptime,
  preloadSystemInfo,
  updateSystemInfo,
  preloadShardCount,
  updateShardCount,
  preloadNetworkHealth,
  updateNetworkHealth
} from '../components/Dashboard/dashboard.action';
import {
  updateCoinbase,
  preloadCoinbase,
  updatePeers,
  preloadPeers
} from '../components/NodeCard/nodeCard.actions';
import {
  updateTx,
  preloadTx
} from '../components/TransactionList/transactionList.actions'
import { env } from '../env'

const socket = io(env.SOCKET_SERVER, { path: '/apex-ws', transports: ['websocket'] });

export function registerActions(eventChannelEmit, room, preloadAction, eventAction) {
  socket.on(`PRELOAD_${room}`, data => {
    eventChannelEmit(preloadAction(data));
  })

  socket.on(`EVENT_${room}`, data => {
    eventChannelEmit(eventAction(data));
  })
}

export function subscribe() {
  return eventChannel(emit => {
    registerActions(emit, LAST_BLOCK_NUMBER, preloadBlockNumber, updateBlockNumber)
    registerActions(emit, USERS_COUNT, preloadUsersCount, updateUsersCount)
    registerActions(emit, CONTRACTS_COUNT, preloadContractCount, updateContractCount)
    registerActions(emit, GET_TRANSACTIONS, preloadTx, updateTx)
    registerActions(emit, BLOCKS_DIFFICULTY, preloadBlockDifficulty, updateBlockDifficulty)
    registerActions(emit, BLOCKS_PROPAGATION, preloadBlockPropagation, updateBlockPropagation)
    registerActions(emit, TRANSACTIONS_COUNT, preloadTransactionsCount, updateTransactionCount)
    registerActions(emit, TRANSACTIONS_TYPE, preloadTransactionType, updateTransactionType)
    registerActions(emit, GET_PEERS, preloadPeers, updatePeers)
    registerActions(emit, GET_COINBASE, preloadCoinbase, updateCoinbase)
    registerActions(emit, GET_HEALTH, preloadHealth, updateHealth)
    registerActions(emit, GET_NODE_UPTIME, preloadNodeUptime, updateNodeUptime)
    registerActions(emit, GET_SYSTEM_INFO, preloadSystemInfo, updateSystemInfo)
    registerActions(emit, GET_SHARD_COUNT, preloadShardCount, updateShardCount)
    registerActions(emit, GET_NETWORK_HEALTH, preloadNetworkHealth, updateNetworkHealth )
    socket.on('disconnect', e => {
      // TODO: handle
    });
    return () => { };
  });
}

export function* readSocketEvents() {
  const channel = yield call(subscribe);
  while (true) {
    let action = yield take(channel);
    yield put(action);
  }
}

export function* socketSubscribeUnsubscribeRoom(action) {
  yield socket.emit(action.name)
}

export function* watchCommunicateOverSocket() {
  yield takeEvery(SOCKET_SUBSCRIBE_ROOM, socketSubscribeUnsubscribeRoom);
  yield takeEvery(SOCKET_UNSUBSCRIBE_ROOM, socketSubscribeUnsubscribeRoom);
  yield fork(readSocketEvents)
}

