import reducer from '../../components/Dashboard/dashboard.reducer';
import {
  preloadBlockNumber,
  updateBlockNumber,
  preloadContractCount,
  updateContractCount,
  preloadUsersCount,
  updateUsersCount,
  preloadTransactionsCount,
  updateTransactionCount,
  preloadBlockDifficulty,
  updateBlockDifficulty,
  preloadBlockPropagation,
  updateBlockPropagation,
  preloadTransactionType,
  updateTransactionType
} from '../../components/Dashboard/dashboard.action';
import { dashboard, initialState } from './dashboardMock';

describe('Test contracts reducer', () => {

  // INITIAL_STATE
  test('should set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // PRELOAD_BLOCK_NUMBER
  test('should store block number', () => {
    const action = preloadBlockNumber(dashboard.lastBlockNumber);
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // UPDATE_BLOCK_NUMBER
  test('should update block number', () => {
    let lastBlockNumber = 2;
    const action = updateBlockNumber(lastBlockNumber);
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // PRELOAD_CONTRACT_COUNT
  test('should load contracts count', () => {
    const action = preloadContractCount(dashboard.contractsCount);
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // UPDATE_CONTRACT_COUNT
  test('should update contracts count', () => {
    let contractsCount = 4;
    const action = updateContractCount(contractsCount);
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // PRELOAD_USERS_COUNT
  test('should load users count', () => {
    const action = preloadUsersCount(dashboard.usersCount);
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // UPDATE_USERS_COUNT
  test('should update users count', () => {
    let usersCount = 2;
    const action = updateUsersCount(usersCount);
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // PRELOAD_TRANSACTION_COUNT
  test('should load transactions count', () => {
    const action = preloadTransactionsCount(dashboard.transactionsCount);
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // UPDATE_TRANSACTION_COUNT
  test('should update transactions count', () => {
    let transactionsCount = [{
      "x": 0,
      "y": 0
    }];
    const action = updateTransactionCount(transactionsCount);
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // PRELOAD_BLOCK_DIFFICULTY
  test('should load block difficulty', () => {
    const action = preloadBlockDifficulty(dashboard.blockDifficulty);
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // UPDATE_BLOCK_DIFFICULTY
  test('should update block difficulty', () => {
    let blockDifficulty = [{
      "x": 0,
      "y": 8
    }];
    const action = updateBlockDifficulty(blockDifficulty);
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // PRELOAD_BLOCK_PROPAGATION
  test('should load block propagation', () => {
    const action = preloadBlockPropagation(dashboard.blockPropagation);
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // UPDATE_BLOCK_PROPAGATION
  test('should update block propagation', () => {
    let blockPropagation = [{
      "x": 0,
      "y": 3358
    }];
    const action = updateBlockPropagation(blockPropagation);
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // PRELOAD_TRANSACTION_TYPES
  test('should load transaction types', () => {
    const action = preloadTransactionType(dashboard.transactionTypes);
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // UPDATE_TRANSACTION_TYPES
  test('should update transaction types', () => {
    let transactionTypes = [{
      "val": 1,
      "type": "Transfer"
    },
    {
      "val": 2,
      "type": "Contract"
    }];
    const action = updateTransactionType(transactionTypes);
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

});