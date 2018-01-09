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

describe('Dashboard: actions', () => {

  describe('blockNumber:', () => {

    test('load', () => {
      expect(preloadBlockNumber(dashboard.lastBlockNumber)).toMatchSnapshot();
    });

    test('update', () => {
      let lastBlockNumber = 5;
      expect(updateBlockNumber(lastBlockNumber)).toMatchSnapshot();
    });

  });

  describe('contractsCount:', () => {

    test('load', () => {
      expect(preloadContractCount(dashboard.contractsCount)).toMatchSnapshot();
    });

    test('update', () => {
      let contractsCount = 2;
      expect(updateContractCount(contractsCount)).toMatchSnapshot();
    });

  });

  describe('usersCount:', () => {

    test('load', () => {
      expect(preloadUsersCount(dashboard.usersCount)).toMatchSnapshot();
    });

    test('update', () => {
      let usersCount = 2;
      expect(updateUsersCount(usersCount)).toMatchSnapshot();
    });

  });

  describe('transactionsCount:', () => {

    test('load', () => {
      expect(preloadTransactionsCount(dashboard.transactionsCount)).toMatchSnapshot();
    });

    test('update', () => {
      let transactionsCount = 2;
      expect(updateTransactionCount(transactionsCount)).toMatchSnapshot();
    });
  });

  describe('blockPropagation:', () => {

    test('load', () => {
      expect(preloadBlockPropagation(dashboard.blockPropagation)).toMatchSnapshot();
    });

    test('update', () => {
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
    });
  });

  describe('blockDifficulty:', () => {

    test('load', () => {
      expect(preloadBlockDifficulty(dashboard.blockDifficulty)).toMatchSnapshot();
    });

    test('update', () => {
      let blockDifficulty = [
        {
          "x": 0,
          "y": 5
        }
      ];
      expect(updateBlockDifficulty(blockDifficulty)).toMatchSnapshot();
    });

  });

  describe('transactionTypes:', () => {

    test('load', () => {
      expect(preloadTransactionType(dashboard.transactionTypes)).toMatchSnapshot();
    });

    test('update', () => {
      let transactionTypes = [
        {
          "val": 3,
          "type": "FunctionCall"
        }
      ];
      expect(updateTransactionType(transactionTypes)).toMatchSnapshot();
    });

  });

})