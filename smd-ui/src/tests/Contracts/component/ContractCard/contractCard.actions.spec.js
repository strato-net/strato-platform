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
  fetchAccountFailure,
  fetchContractInfoRequest,
  fetchContractInfoSuccess,
  fetchContractInfoFailure,
} from '../../../../components/Contracts/components/ContractCard/contractCard.actions';
import { contract, modals } from './contractCardMock';

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
  describe('fetch contract info snapshots', () => {

    test('request', () => {
      expect(fetchContractInfoRequest(modals.key, modals.name, modals.address, modals.chainId)).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchContractInfoSuccess(modals.key, {address: modals.address, chainId: modals.chainId, xabi: {}})).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchContractInfoFailure(modals.key, modals.error)).toMatchSnapshot();
    });

  })
});