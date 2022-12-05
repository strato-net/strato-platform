import reducer from '../../components/Contracts/contracts.reducer';
import { contracts, filter, contractsState, error, reducerContract } from "./contractsMock";
import {
  fetchContracts,
  fetchContractsSuccess,
  fetchContractsFailure,
  changeContractFilter
} from '../../components/Contracts/contracts.actions';
import {
  fetchStateSuccess, selectContractInstance, fetchAccount, fetchAccountSuccess, fetchCirrusInstancesSuccess
} from '../../components/Contracts/components/ContractCard/contractCard.actions';
import { deepClone } from '../helper/testHelper';

describe('Contracts: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('fetch contracts', () => {

    // FETCH_CONTRACTS
    test('request', () => {
      const action = fetchContracts();
      const initialState = {
        contracts: contractsState,
        filter,
        isLoading: true
      }
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // FETCH_CONTRACTS_SUCCESSFUL
    describe('on success', () => {

      test('with initialstate of contract do not have values', () => {
        const action = fetchContractsSuccess(contracts);
        const initialState = {
          contracts: {},
          filter: '',
          error: null,
          isLoading: false
        }
        expect(reducer(initialState, action)).toMatchSnapshot();
      });

      test('with initialstate of contract has values', () => {
        const data = {
          "Cloner": [
            {
              "createdAt": 1512480630000,
              "address": "d07e932212f7f368b6948ffd96e1d4c726c8395d"
            },
            {
              "createdAt": 1512480770000,
              "address": "2c6619f0418c2f191e2225091f7692363a91c336"
            }
          ],
          "Diff": [
            {
              "createdAt": 1512480630000,
              "address": "d07e932212f7f121b6948ffd96e1d4c726c8395d"
            },
            {
              "createdAt": 1512480770000,
              "address": "2c6619f0418c2f121e2225091f7692363a91c336"
            }
          ]
        };
        const action = fetchContractsSuccess(data);
        const initialState = {
          contracts: deepClone(contractsState),
          filter: '',
          error: null,
          isLoading: false
        }

        expect(reducer(initialState, action)).toMatchSnapshot();
      });

    });

    // FETCH_CONTRACTS_FAILED
    test('on failure', () => {
      const action = fetchContractsFailure(error);
      const initialState = {
        contracts: {},
        filter: '',
        error,
        isLoading: false
      };
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

  // CHANGE_CONTRACT_FILTER
  test('on change contract filter', () => {
    const action = changeContractFilter(filter);
    const initialState = {
      contracts: contractsState,
      error: null,
      isLoading: false
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // FETCH_STATE_SUCCESS
  describe('fetch state', () => {

    test('update with appending state in contracts', () => {
      const action = fetchStateSuccess(reducerContract.name, reducerContract.address, reducerContract.state);
      let initialContracts = deepClone(contractsState);
      initialContracts['GreeterA']['instances'][0]['selected'] = true;
      const initialState = {
        contracts: initialContracts,
        filter: filter,
        error: 'ERROR'
      }
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    test('update without appending state in contracts', () => {
      const action = fetchStateSuccess(reducerContract.name, 'd07e932212f7f368b6948ffd96e1d4c726c8395', reducerContract.state);
      let initialContracts = deepClone(contractsState);
      initialContracts['GreeterA']['instances'][0]['selected'] = true;
      const initialState = {
        contracts: initialContracts,
        filter: filter,
        error: 'ERROR'
      }
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

  // SELECT_CONTRACT_INSTANCE
  test('select contract instance', () => {
    const action = selectContractInstance(reducerContract.name, reducerContract.address);
    const initialState = {
      contracts: contractsState,
      filter,
      error
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // FETCH_ACCOUNT_SUCCESS
  test('fetch account success', () => {
    const action = fetchAccountSuccess(reducerContract.name, reducerContract.address, reducerContract.account);
    let initialContracts = deepClone(contractsState);
    initialContracts['GreeterA']['instances'][0]['selected'] = true;
    const initialState = {
      contracts: initialContracts,
      filter
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // FETCH_CIRRUS_INSTANCES_SUCCESS
  test('fetch cirrus instances success', () => {
    const data = {
      instances: [
        {
          address: "b7b986bf23faebd8d745c65fa42a8c2f0fc2ebb9",
          greetingB: ""
        }],
      name: "GreeterB"
    }
    const action = fetchCirrusInstancesSuccess(data.name, data.instances);
    const initialState = {
      contracts: contractsState,
      filter,
      error,
      isLoading: false
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

})
