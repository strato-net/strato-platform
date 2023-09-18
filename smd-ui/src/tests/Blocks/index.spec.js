import React from 'react';
import Blocks from '../../components/Blocks/index';
import { reducer as formReducer } from 'redux-form';
import { createStore, combineReducers } from 'redux';

describe('Blocks: index', () => {
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
        <Blocks.WrappedComponent {...props} />
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
        <Blocks.WrappedComponent {...props} />
      ).dive().dive().dive();
      expect(wrapper).toMatchSnapshot();
    });

  });

});