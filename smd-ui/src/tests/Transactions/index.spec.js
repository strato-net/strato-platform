import React from 'react';
import Transactions, { mapStateToProps } from '../../components/Transactions/index';
import { reducer as formReducer } from 'redux-form';
import { createStore, combineReducers } from 'redux';

describe('Transactions: index', () => {

  let store;
  let mockFunction;

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }));
    mockFunction = {
      fetchChainIds: jest.fn(),
      selectChain: jest.fn(),
    };
  });

  describe('render component', () => {

    test('With values', () => {
      const props = {
        chainIds: [{
          label: 'mock-label',
          id: 'a1021e62fbb7fe282b7e2bd1ca26325af02bb43e'
        }],
        store: store,
        ...mockFunction
      }

      const wrapper = shallow(
        <Transactions.WrappedComponent {...props} />
      ).dive().dive().dive();
      expect(wrapper).toMatchSnapshot();
    });
    
    test('without values', () => {
      const props = {
        chainIds: [],
        store: store,
        ...mockFunction
      }

      const wrapper = shallow(
        <Transactions.WrappedComponent {...props} />
      ).dive().dive().dive();
      expect(wrapper).toMatchSnapshot();
    });

  });

  test('mapStateToProps with default values', () => {
    const state = {
      chains: {
        chainIds: [{
          label: 'mock-label',
          id: 'a1021e62fbb7fe282b7e2bd1ca26325af02bb43e'
        }],
      },
      user: {
        oauthUser: {
          "username": "tanuj41",
          "address": "86ee0c9644611495c0a1b1074e40d4e6db2f6b26"
        }
      }
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

})