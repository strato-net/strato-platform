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

  it('should load block number', () => {
    expect(preloadBlockNumber(dashboard.lastBlockNumber)).toMatchSnapshot();
  })

  it('should update block number', () => {
    let lastBlockNumber = 5;
    expect(updateBlockNumber(lastBlockNumber)).toMatchSnapshot();
  })

  it('should load contracts count', () => {
    expect(preloadContractCount(dashboard.contractsCount)).toMatchSnapshot();
  })

  it('should update contracts count', () => {
    let contractsCount = 2;
    expect(updateContractCount(contractsCount)).toMatchSnapshot();
  })

  it('should load users count', () => {
    expect(preloadUsersCount(dashboard.usersCount)).toMatchSnapshot();
  })

  it('should update users count', () => {
    let usersCount = 2;
    expect(updateUsersCount(usersCount)).toMatchSnapshot();
  })

  it('should load transactions count', () => {
    expect(preloadTransactionsCount(dashboard.transactionsCount)).toMatchSnapshot();
  })

  it('should update transactions count', () => {
    let transactionsCount = 2;
    expect(updateTransactionCount(transactionsCount)).toMatchSnapshot();
  })

  it('should load block propagation', () => {
    expect(preloadBlockPropagation(dashboard.blockPropagation)).toMatchSnapshot();
  })

  it('should update block propagation', () => {
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

  it('should load block difficulty', () => {
    expect(preloadBlockDifficulty(dashboard.blockDifficulty)).toMatchSnapshot();
  })

  it('should update block difficulty', () => {
    let blockDifficulty = [
      {
        "x": 0,
        "y": 5
      }
    ];
    expect(updateBlockDifficulty(blockDifficulty)).toMatchSnapshot();
  })

  it('should load transaction type', () => {
    expect(preloadTransactionType(dashboard.transactionTypes)).toMatchSnapshot();
  })

  it('should update transaction type', () => {
    let transactionTypes = [
      {
        "val": 3,
        "type": "FunctionCall"
      }
    ];
    expect(updateTransactionType(transactionTypes)).toMatchSnapshot();
  })

})