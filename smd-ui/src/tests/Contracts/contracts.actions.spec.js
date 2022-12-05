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
      let chainId = "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9";
      const limit = 10;
      const offset = 0;
      expect(fetchContracts(chainId, limit, offset)).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchContractsSuccess(contracts)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchContractsFailure(error)).toMatchSnapshot();
    });

  })

});