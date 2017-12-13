import {
  fetchState,
  fetchStateSuccess,
  fetchStateFailure,
  selectContractInstance,
  fetchCirrusInstances,
  fetchCirrusInstancesSuccess,
  fetchCirrusInstancesFailure,
  fetchAccount,
  fetchAccountSuccess,
  fetchAccountFailure
} from '../../../../components/Contracts/components/ContractCard/contractCard.actions';
import { contract } from './contractCardMock';

describe('Test ContractCard actions', () => {

  test('should create an action to fetch state', () => {
    expect(fetchState(contract.name, contract.address)).toMatchSnapshot();
  });

  test('should return state after FETCH_STATE_REQUEST success', () => {
    expect(fetchStateSuccess(contract.name, contract.address, contract.state)).toMatchSnapshot();
  });

  test('should return error after FETCH_STATE_REQUEST failure', () => {
    expect(fetchStateFailure(contract.error)).toMatchSnapshot();
  });

  test('select contract instance', () => {
    expect(selectContractInstance(contract.name, contract.address)).toMatchSnapshot();
  });

  test('should create an action to fetch instance', () => {
    expect(fetchCirrusInstances(contract.name)).toMatchSnapshot();
  });

  test('should return instance after FETCH_CIRRUS_INSTANCES_REQUEST success', () => {
    expect(fetchCirrusInstancesSuccess(contract.name, contract.instances)).toMatchSnapshot();
  });

  test('should return error after FETCH_CIRRUS_INSTANCES_REQUEST with failure', () => {
    expect(fetchCirrusInstancesFailure(contract.name, contract.error)).toMatchSnapshot();
  });

  test('should create an action to fetch account', () => {
    expect(fetchAccount(contract.name, contract.address)).toMatchSnapshot();
  });

  test('should return account after FETCH_ACCOUNT_REQUEST success', () => {
    expect(fetchAccountSuccess(contract.name, contract.address, contract.account)).toMatchSnapshot();
  });

  test('should return error after FETCH_ACCOUNT_REQUEST failure', () => {
    expect(fetchAccountFailure(contract.name, contract.address, contract.error)).toMatchSnapshot();
  });

});