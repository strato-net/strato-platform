import {
  preloadBlockNumber,
  updateBlockNumber,
  preloadContractCount,
  updateContractCount,
  preloadUsersCount,
  updateUsersCount,
  preloadTransactionsCount,
  updateTransactionCount,
  preloadBlockPropagation,
  updateBlockPropagation,
  preloadBlockDifficulty,
  updateBlockDifficulty,
  preloadTransactionType,
  updateTransactionType
} from '../../components/Dashboard/dashboard.action'
import { dashboard } from './dashboardMock';

describe('Test dashboard actions', () => {

  test('should load block number', () => {
    expect(preloadBlockNumber(dashboard.lastBlockNumber)).toMatchSnapshot();
  })

  test('should update block number', () => {
    let lastBlockNumber = 5;
    expect(updateBlockNumber(lastBlockNumber)).toMatchSnapshot();
  })

  test('should load contracts count', () => {
    expect(preloadContractCount(dashboard.contractsCount)).toMatchSnapshot();
  })

  test('should update contracts count', () => {
    let contractsCount = 2;
    expect(updateContractCount(contractsCount)).toMatchSnapshot();
  })

  test('should load users count', () => {
    expect(preloadUsersCount(dashboard.usersCount)).toMatchSnapshot();
  })

  test('should update users count', () => {
    let usersCount = 2;
    expect(updateUsersCount(usersCount)).toMatchSnapshot();
  })

  test('should load transactions count', () => {
    expect(preloadTransactionsCount(dashboard.transactionsCount)).toMatchSnapshot();
  })

  test('should update transactions count', () => {
    let transactionsCount = 2;
    expect(updateTransactionCount(transactionsCount)).toMatchSnapshot();
  })

  test('should load block propagation', () => {
    expect(preloadBlockPropagation(dashboard.blockPropagation)).toMatchSnapshot();
  })

  test('should update block propagation', () => {
    let blockPropagation = [
      {
        "x": 0,
        "y": 0
      },
      {
        "x": 1,
        "y": 4
      }
    ];
    expect(updateBlockPropagation(blockPropagation)).toMatchSnapshot();
  })

  test('should load block difficulty', () => {
    expect(preloadBlockDifficulty(dashboard.blockDifficulty)).toMatchSnapshot();
  })

  test('should update block difficulty', () => {
    let blockDifficulty = [
      {
        "x": 0,
        "y": 5
      }
    ];
    expect(updateBlockDifficulty(blockDifficulty)).toMatchSnapshot();
  })

  test('should load transaction type', () => {
    expect(preloadTransactionType(dashboard.transactionTypes)).toMatchSnapshot();
  })

  test('should update transaction type', () => {
    let transactionTypes = [
      {
        "val": 3,
        "type": "FunctionCall"
      }
    ];
    expect(updateTransactionType(transactionTypes)).toMatchSnapshot();
  })

})