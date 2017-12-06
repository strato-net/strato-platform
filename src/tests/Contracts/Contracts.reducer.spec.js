import React from 'react';
import reducer from '../../components/Contracts/contracts.reducer';

test('Should initail state', () => {
  const initialState = {
    contracts: {},
    filter: '',
    error: null,
  };
  expect(reducer(undefined,{})).toEqual(initialState)
});
