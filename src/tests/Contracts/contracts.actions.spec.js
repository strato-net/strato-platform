import {
  fetchContracts,
  fetchContractsSuccess,
  fetchContractsFailure,
  changeContractFilter
} from '../../components/Contracts/contracts.actions';
import { contracts, filter, error } from './contractsMock';

describe('Test contracts actions', () => {

  test('should create an action to fetch contracts', () => {
    expect(fetchContracts()).toMatchSnapshot();
  });

  test('should return contracts after successfull response', () => {
    expect(fetchContractsSuccess(contracts)).toMatchSnapshot();
  });

  test('should return error after failure response', () => {
    expect(fetchContractsFailure(error)).toMatchSnapshot();
  });

  test('should change contract filter', () => {
    expect(changeContractFilter(filter)).toMatchSnapshot();
  });

});