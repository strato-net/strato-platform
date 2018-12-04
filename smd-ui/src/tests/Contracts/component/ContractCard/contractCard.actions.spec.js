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

describe('ContractCard: action', () => {

  describe('fetch state', () => {

    test('request', () => {
      expect(fetchState(contract.name, contract.address, contract.chainId)).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchStateSuccess(contract.name, contract.address, contract.state)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchStateFailure(contract.error)).toMatchSnapshot();
    });

  })

  test('select contract instance', () => {
    expect(selectContractInstance(contract.name, contract.address)).toMatchSnapshot();
  });

  describe('fetch instance', () => {

    test('request', () => {
      expect(fetchCirrusInstances(contract.name)).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchCirrusInstancesSuccess(contract.name, contract.instances)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchCirrusInstancesFailure(contract.name, contract.error)).toMatchSnapshot();
    });

  })

  describe('fetch account', () => {

    test('request', () => {
      expect(fetchAccount(contract.name, contract.address)).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchAccountSuccess(contract.name, contract.address, contract.account)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchAccountFailure(contract.name, contract.address, contract.error)).toMatchSnapshot();
    });

  })

});