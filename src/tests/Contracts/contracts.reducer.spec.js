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


describe('Test contracts reducer', () => {

  // INITIAL_STATE
  test('should set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // FETCH_CONTRACTS
  test('should fetch contracts', () => {
    const action = fetchContracts();

    const initialState = {
      contracts: contractsState,
      filter
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // FETCH_CONTRACTS_SUCCESSFUL
  test('should store contracts after success', () => {
    const action = fetchContractsSuccess(contracts);

    const initialState = {
      contracts: {},
      filter: '',
      error: null
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // FETCH_CONTRACTS_FAILED
  test('should update error if fetch contracts failed', () => {
    const action = fetchContractsFailure(error);

    const initialState = {
      contracts: {},
      filter: '',
      error
    };

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // CHANGE_CONTRACT_FILTER
  test('should update filter while searching contract', () => {
    const action = changeContractFilter(filter);

    const initialState = {
      contracts: contractsState,
      error: null
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // FETCH_STATE_SUCCESS
  test('should fetch state and append it to contract', () => {
    const action = fetchStateSuccess(reducerContract.name, reducerContract.address, reducerContract.state);

    let initialContracts = deepClone(contractsState);
    initialContracts['GreeterA']['instances'][0]['selected'] = true;

    const initialState = {
      contracts: initialContracts,
      filter: filter,
      error: 'ERROR'
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // SELECT_CONTRACT_INSTANCE
  test('should select contract instance', () => {
    const action = selectContractInstance(reducerContract.name, reducerContract.address);

    const initialState = {
      contracts: contractsState,
      filter,
      error
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // FETCH_ACCOUNT_SUCCESS
  test('should fetch account', () => {
    const action = fetchAccountSuccess(reducerContract.name, reducerContract.address, reducerContract.account);

    let initialContracts = deepClone(contractsState);
    initialContracts['GreeterA']['instances'][0]['selected'] = true;

    const initialState = {
      contracts: initialContracts,
      filter
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // FETCH_CIRRUS_INSTANCES_SUCCESS
  test('Should fetch cirrus instances', () => {
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
      error
    }

    expect((initialState, action)).toMatchSnapshot();
  })

})
