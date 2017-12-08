import {
  fetchContracts,
  FETCH_CONTRACTS,
  fetchContractsSuccess,
  FETCH_CONTRACTS_SUCCESSFUL,
  fetchContractsFailure,
  FETCH_CONTRACTS_FAILED,
  changeContractFilter,
  CHANGE_CONTRACT_FILTER
} from '../../components/Contracts/contracts.actions';

describe('Test contracts actions', () => {

  test('should create an action to fetch contracts', () => {
    const expectedAction = {
      type: 'FETCH_CONTRACTS'
    }
    expect(fetchContracts()).toEqual(expectedAction)
  });

  test('should return contracts after successfull response', () => {
    const expectedAction = {
      type: 'FETCH_CONTRACTS_SUCCESSFUL',
      contracts: 'contracts'
    }
    expect(fetchContractsSuccess('contracts')).toEqual(expectedAction)
  });

  test('should return error after failure response', () => {
    const expectedAction = {
      type: 'FETCH_CONTRACTS_FAILED',
      error: 'error'
    }
    expect(fetchContractsFailure('error')).toEqual(expectedAction)
  });

  test('should change contract filter', () => {
    const expectedAction = {
      type: 'CHANGE_CONTRACT_FILTER',
      filter: 'filter'
    }
    expect(changeContractFilter('filter')).toEqual(expectedAction)
  });

});