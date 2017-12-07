import React from 'react';
import reducer from '../../components/Contracts/contracts.reducer';
import { contracts, filter, contractState } from "./Mock";
import {
  FETCH_CONTRACTS,
  FETCH_CONTRACTS_SUCCESSFUL,
  FETCH_CONTRACTS_FAILED,
  CHANGE_CONTRACT_FILTER
} from '../../components/Contracts/contracts.actions';
import {
  FETCH_STATE_SUCCESS,
  SELECT_CONTRACT_INSTANCE,
  FETCH_ACCOUNT_SUCCESS
} from '../../components/Contracts/components/ContractCard/contractCard.actions';

// INITIAL_STATE
test('Should initial state set', () => {
  const initialState = {
    contracts: {},
    filter: '',
    error: null,
  };
  expect(reducer(undefined, {})).toEqual(initialState)
});

// FETCH_CONTRACTS
test('should FETCH_CONTRACTS initiate', () => {
  const action = {
    type: FETCH_CONTRACTS
  };

  const stateAfter = {
    contracts: contractState,
    filter: filter,
    error: null,
  }

  expect(reducer({ contracts: contractState, filter: filter }, action)).toEqual(stateAfter)
})

// FETCH_CONTRACTS_SUCCESSFUL
test('should FETCH_CONTRACTS_SUCCESSFUL', () => {
  const action = {
    type: FETCH_CONTRACTS_SUCCESSFUL,
    contracts: contracts
  };

  const stateAfter = {
    contracts: contractState,
    filter: filter,
    error: 'error'
  }

  expect(reducer({ contracts: {}, filter: filter, error: 'error' }, action)).toEqual(stateAfter)
})

// FETCH_CONTRACTS_FAILED
test('should FETCH_CONTRACTS_FAILED', () => {
  const action = {
    type: FETCH_CONTRACTS_FAILED,
    error: 'error'
  };

  const stateAfter = {
    contracts: contracts,
    filter: filter,
    error: 'error'
  };

  expect(reducer({ contracts: contracts, filter: filter }, action)).toEqual(stateAfter)
})

// CHANGE_CONTRACT_FILTER
test('Should CHANGE_CONTRACT_FILTER', () => {
  const action = {
    type: CHANGE_CONTRACT_FILTER,
    filter: filter
  };

  const stateAfter = {
    contracts: contracts,
    filter: filter,
    error: 'error'
  }

  expect(reducer({ contracts: contracts, error: 'error' }, action)).toEqual(stateAfter)
})

// FETCH_STATE_SUCCESS
test('Should FETCH_STATE_SUCCESS', () => {
  const action = {
    address: "0293f9b10a4453667db7fcfe74728c9d821add4b",
    name: "GreeterA",
    state: {
      "greetA": "function () returns (Address)",
      "greetingA": "Aaaaaaaaa"
    },
    type: "FETCH_STATE_SUCCESS"
  }

  let contract = contractState;
  contract['GreeterA']['instances'][0]['selected'] = true;

  let expectedContract = contractState;
  expectedContract['GreeterA']['instances'][0]['selected'] = true;
  expectedContract['GreeterA']['instances'][0]['state'] = {
    "greetA": "function () returns (Address)",
    "greetingA": "Aaaaaaaaa"
  };

  const stateAfter = {
    contracts: expectedContract,
    filter: filter,
    error: 'error'
  }

  expect(reducer({ contracts: contract, error: 'error', filter: filter }, action)).toEqual(stateAfter)
})

// SELECT_CONTRACT_INSTANCE
test('Should SELECT_CONTRACT_INSTANCE', () => {
  const action = {
    address: "0293f9b10a4453667db7fcfe74728c9d821add4b",
    name: "GreeterA",
    type: "SELECT_CONTRACT_INSTANCE"
  }

  let expectedContract = contractState;
  expectedContract['GreeterA']['instances'][0]['selected'] = true;

  const stateAfter = {
    contracts: expectedContract,
    filter: filter,
    error: 'error'
  }

  expect(reducer({ contracts: contractState, error: 'error', filter: filter }, action)).toEqual(stateAfter)
})

// FETCH_ACCOUNT_SUCCESS
test('Should FETCH_ACCOUNT_SUCCESS', () => {
  const action = {
    account: [{ balance: 0 }],
    address: "0293f9b10a4453667db7fcfe74728c9d821add4b",
    name: "GreeterA",
    type: "FETCH_ACCOUNT_SUCCESS"
  }

  let contract = contractState;
  contract['GreeterA']['instances'][0]['selected'] = true;

  let expectedContract = contractState;
  expectedContract['GreeterA']['instances'][0]['selected'] = true;
  expectedContract['GreeterA']['instances'][0]['balance'] = 0;

  const stateAfter = {
    contracts: expectedContract,
    filter: filter,
    error: null
  }
  expect(reducer({ contracts: contract, filter: filter }, action)).toEqual(stateAfter)
})

