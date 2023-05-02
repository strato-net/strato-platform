import {
  subscribeRoom,
  unSubscribeRoom
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
  BLOCKS_FREQUENCY,
  GET_NODE_UPTIME,
  GET_HEALTH,
  GET_SHARD_COUNT
} from '../../sockets/rooms';

describe('Socket: action', () => {

  describe('subscribe', () => {

    test('last block number', () => {
      expect(subscribeRoom(LAST_BLOCK_NUMBER)).toMatchSnapshot();
    });

    test('users count', () => {
      expect(subscribeRoom(USERS_COUNT)).toMatchSnapshot();
    });

    test('contracts count', () => {
      expect(subscribeRoom(CONTRACTS_COUNT)).toMatchSnapshot();
    });

    test('block propagation', () => {
      expect(subscribeRoom(BLOCKS_PROPAGATION)).toMatchSnapshot();
    });

    test('block frequency', () => {
      expect(subscribeRoom(BLOCKS_FREQUENCY)).toMatchSnapshot();
    });

    test('block difficulty', () => {
      expect(subscribeRoom(BLOCKS_DIFFICULTY)).toMatchSnapshot();
    });

    test('transactions count', () => {
      expect(subscribeRoom(TRANSACTIONS_COUNT)).toMatchSnapshot();
    });

    test('transactions type', () => {
      expect(subscribeRoom(TRANSACTIONS_TYPE)).toMatchSnapshot();
    });

    test('peers', () => {
      expect(subscribeRoom(GET_PEERS)).toMatchSnapshot();
    });

    test('coinbase', () => {
      expect(subscribeRoom(GET_COINBASE)).toMatchSnapshot();
    });

    test('transactions', () => {
      expect(subscribeRoom(GET_TRANSACTIONS)).toMatchSnapshot();
    });

    test('health', () => {
      expect(subscribeRoom(GET_HEALTH)).toMatchSnapshot();
    });

    test('uptime', () => {
      expect(subscribeRoom(GET_NODE_UPTIME)).toMatchSnapshot();
    });

    test('shard count', () => {
      expect(subscribeRoom(GET_SHARD_COUNT)).toMatchSnapshot();
    });
  })

  describe('unsubscribe', () => {

    test('last block number', () => {
      expect(unSubscribeRoom(LAST_BLOCK_NUMBER)).toMatchSnapshot();
    });

    test('users count', () => {
      expect(unSubscribeRoom(USERS_COUNT)).toMatchSnapshot();
    });

    test('contracts count', () => {
      expect(unSubscribeRoom(CONTRACTS_COUNT)).toMatchSnapshot();
    });

    test('block propagation', () => {
      expect(unSubscribeRoom(BLOCKS_PROPAGATION)).toMatchSnapshot();
    });

    test('block frequency', () => {
      expect(unSubscribeRoom(BLOCKS_FREQUENCY)).toMatchSnapshot();
    });

    test('blocks difficulty', () => {
      expect(unSubscribeRoom(BLOCKS_DIFFICULTY)).toMatchSnapshot();
    });

    test('transactions count', () => {
      expect(unSubscribeRoom(TRANSACTIONS_COUNT)).toMatchSnapshot();
    });

    test('transactions type', () => {
      expect(unSubscribeRoom(TRANSACTIONS_TYPE)).toMatchSnapshot();
    });

    test('coinbase', () => {
      expect(unSubscribeRoom(GET_COINBASE)).toMatchSnapshot();
    });

    test('peers', () => {
      expect(unSubscribeRoom(GET_PEERS)).toMatchSnapshot();
    });

    test('transactions', () => {
      expect(unSubscribeRoom(GET_TRANSACTIONS)).toMatchSnapshot();
    });

    test('health', () => {
      expect(unSubscribeRoom(GET_HEALTH)).toMatchSnapshot();
    });

    test('uptime', () => {
      expect(unSubscribeRoom(GET_NODE_UPTIME)).toMatchSnapshot();
    });

    test('shard count', () => {
      expect(unSubscribeRoom(GET_SHARD_COUNT)).toMatchSnapshot();
    });


  })

});
