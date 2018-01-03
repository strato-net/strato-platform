import {
  fetchContracts,
  fetchContractsSuccess,
  fetchContractsFailure,
  changeContractFilter
} from '../../components/Contracts/contracts.actions';
import { contracts, filter, error } from './contractsMock';

describe('Contracts: action', () => {

  test('change contract filter', () => {
    expect(changeContractFilter(filter)).toMatchSnapshot();
  });

  describe('fetch contracts', () => {

    test('request', () => {
      expect(fetchContracts()).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchContractsSuccess(contracts)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchContractsFailure(error)).toMatchSnapshot();
    });

  })

});