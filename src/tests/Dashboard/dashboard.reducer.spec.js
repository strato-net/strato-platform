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

describe('Dashboard: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // BLOCK_NUMBER
  describe('BLOCK_NUMBER:', () => {
    // PRELOAD_BLOCK_NUMBER
    test('store', () => {
      const action = preloadBlockNumber(dashboard.lastBlockNumber);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // UPDATE_BLOCK_NUMBER
    test('update', () => {
      let lastBlockNumber = 2;
      const action = updateBlockNumber(lastBlockNumber);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });
  });

  // CONTRACT_COUNT
  describe('CONTRACT_COUNT:', () => {
    // PRELOAD_CONTRACT_COUNT
    test('store', () => {
      const action = preloadContractCount(dashboard.contractsCount);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // UPDATE_CONTRACT_COUNT
    test('update', () => {
      let contractsCount = 4;
      const action = updateContractCount(contractsCount);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });
  });

  // USERS_COUNT
  describe('USERS_COUNT:', () => {
    // PRELOAD_USERS_COUNT
    test('store', () => {
      const action = preloadUsersCount(dashboard.usersCount);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // UPDATE_USERS_COUNT
    test('update', () => {
      let usersCount = 2;
      const action = updateUsersCount(usersCount);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });
  });

  // TRANSACTION_COUNT
  describe('TRANSACTION_COUNT:', () => {
    // PRELOAD_TRANSACTION_COUNT
    test('store', () => {
      const action = preloadTransactionsCount(dashboard.transactionsCount);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // UPDATE_TRANSACTION_COUNT
    test('update', () => {
      let transactionsCount = [{
        "x": 0,
        "y": 0
      }];
      const action = updateTransactionCount(transactionsCount);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });
  });

  // BLOCK_DIFFICULTY
  describe('BLOCK_DIFFICULTY:', () => {
    // PRELOAD_BLOCK_DIFFICULTY
    test('store', () => {
      const action = preloadBlockDifficulty(dashboard.blockDifficulty);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // UPDATE_BLOCK_DIFFICULTY
    test('update', () => {
      let blockDifficulty = [{
        "x": 0,
        "y": 8
      }];
      const action = updateBlockDifficulty(blockDifficulty);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });
  });

  // BLOCK_PROPAGATION
  describe('BLOCK_PROPAGATION:', () => {
    // PRELOAD_BLOCK_PROPAGATION
    test('store', () => {
      const action = preloadBlockPropagation(dashboard.blockPropagation);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // UPDATE_BLOCK_PROPAGATION
    test('update', () => {
      let blockPropagation = [{
        "x": 0,
        "y": 3358
      }];
      const action = updateBlockPropagation(blockPropagation);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });
  });

  // TRANSACTION_TYPES
  describe('TRANSACTION_TYPES:', () => {
    // PRELOAD_TRANSACTION_TYPES
    test('store', () => {
      const action = preloadTransactionType(dashboard.transactionTypes);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // UPDATE_TRANSACTION_TYPES
    test('update', () => {
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
    });
  });

});