import React from 'react';
import {
  fetchContracts,
  FETCH_CONTRACTS,
  fetchContractsSuccess,
  FETCH_CONTRACTS_SUCCESSFUL,
  fetchContractsFailure,
  FETCH_CONTRACTS_FAILED,
  changeContractFilter,
  CHANGE_CONTRACT_FILTER } from '../../components/Contracts/contracts.actions';

test('Should create an action to fetch contracts', () => {
  const expectedAction = {
    type: 'FETCH_CONTRACTS'
  }
  expect(fetchContracts()).toEqual(expectedAction)
});

test('Should fetch contracts success', () => {
  const expectedAction = {
    type: 'FETCH_CONTRACTS_SUCCESSFUL',
    contracts: 'contracts'
  }
  expect(fetchContractsSuccess('contracts')).toEqual(expectedAction)
});

test('Should fetch contracts fail', () => {
  const expectedAction = {
    type: 'FETCH_CONTRACTS_FAILED',
    error: 'error'
  }
  expect(fetchContractsFailure('error')).toEqual(expectedAction)
});

test('Should contract filter change', () => {
  const expectedAction = {
    type: 'CHANGE_CONTRACT_FILTER',
    filter: 'filter'
  }
  expect(changeContractFilter('filter')).toEqual(expectedAction)
});
