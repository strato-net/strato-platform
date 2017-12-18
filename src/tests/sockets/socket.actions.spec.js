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
  BLOCKS_FREQUENCY
} from '../../sockets/rooms';

describe('Test socket actions', () => {

  test('should create an action to subscribe last block number', () => {
    expect(subscribeRoom(LAST_BLOCK_NUMBER)).toMatchSnapshot();
  });

  test('should create an action to subscribe users count', () => {
    expect(subscribeRoom(USERS_COUNT)).toMatchSnapshot();
  });

  test('should create an action to subscribe contracts count', () => {
    expect(subscribeRoom(CONTRACTS_COUNT)).toMatchSnapshot();
  });

  test('should create an action to subscribe block propagation', () => {
    expect(subscribeRoom(BLOCKS_PROPAGATION)).toMatchSnapshot();
  });

  test('should create an action to subscribe block frequency', () => {
    expect(subscribeRoom(BLOCKS_FREQUENCY)).toMatchSnapshot();
  });

  test('should create an action to subscribe block difficulty', () => {
    expect(subscribeRoom(BLOCKS_DIFFICULTY)).toMatchSnapshot();
  });

  test('should create an action to subscribe transactions count', () => {
    expect(subscribeRoom(TRANSACTIONS_COUNT)).toMatchSnapshot();
  });

  test('should create an action to subscribe transactions type', () => {
    expect(subscribeRoom(TRANSACTIONS_TYPE)).toMatchSnapshot();
  });

  test('should create an action to subscribe peers', () => {
    expect(subscribeRoom(GET_PEERS)).toMatchSnapshot();
  });

  test('should create an action to subscribe coinbase', () => {
    expect(subscribeRoom(GET_COINBASE)).toMatchSnapshot();
  });

  test('should create an action to subscribe last block number', () => {
    expect(subscribeRoom(GET_TRANSACTIONS)).toMatchSnapshot();
  });

  test('should create an action to unsubscribe last block number', () => {
    expect(unSubscribeRoom(LAST_BLOCK_NUMBER)).toMatchSnapshot();
  });

  test('should create an action to unsubscribe users count', () => {
    expect(unSubscribeRoom(USERS_COUNT)).toMatchSnapshot();
  });

  test('should create an action to unsubscribe contracts count', () => {
    expect(unSubscribeRoom(CONTRACTS_COUNT)).toMatchSnapshot();
  });

  test('should create an action to unsubscribe block propagation', () => {
    expect(unSubscribeRoom(BLOCKS_PROPAGATION)).toMatchSnapshot();
  });

  test('should create an action to unsubscribe block frequency', () => {
    expect(unSubscribeRoom(BLOCKS_FREQUENCY)).toMatchSnapshot();
  });

  test('should create an action to unsubscribe blocks difficulty', () => {
    expect(unSubscribeRoom(BLOCKS_DIFFICULTY)).toMatchSnapshot();
  });

  test('should create an action to unsubscribe transactions count', () => {
    expect(unSubscribeRoom(TRANSACTIONS_COUNT)).toMatchSnapshot();
  });

  test('should create an action to unsubscribe transactions type', () => {
    expect(unSubscribeRoom(TRANSACTIONS_TYPE)).toMatchSnapshot();
  });

  test('should create an action to unsubscribe coinbase', () => {
    expect(unSubscribeRoom(GET_COINBASE)).toMatchSnapshot();
  });

  test('should create an action to unsubscribe peers', () => {
    expect(unSubscribeRoom(GET_PEERS)).toMatchSnapshot();
  });

  test('should create an action to unsubscribe peers', () => {
    expect(unSubscribeRoom(GET_TRANSACTIONS)).toMatchSnapshot();
  });

});
