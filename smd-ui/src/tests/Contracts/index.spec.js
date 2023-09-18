import React from 'react';
import Contracts, { mapStateToProps } from '../../components/Contracts/index';
import { chainIds, contracts } from './contractsMock';
import { Provider } from 'react-redux';
import { createStore, combineReducers } from 'redux';
import { reducer as formReducer } from 'redux-form';

describe('Contracts: index', () => {

  let store;

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }));
  });

  describe('render contracts with', () => {

    test('empty values', () => {
      const props = {
        filter: '',
        contracts: {},
        chainIds: [],
        fetchContracts: jest.fn(),
        changeContractFilter: jest.fn()
      }
      const wrapper = shallow(
        <Contracts.WrappedComponent {...props} />
      );
      expect(wrapper).toMatchSnapshot();
    });

    test('mocked values', () => {
      const props = {
        filter: 'Greeter',
        contracts: contracts,
        chainIds: chainIds,
        fetchContracts: jest.fn(),
        changeContractFilter: jest.fn()
      }
      const wrapper = shallow(
        <Contracts.WrappedComponent {...props} />
      );
      expect(wrapper).toMatchSnapshot();
    });

  })

  test('component methods', () => {
    const props = {
      filter: '',
      contracts: {},
      fetchContracts: jest.fn().mockReturnValue('fetchContracts'),
      changeContractFilter: jest.fn().mockReturnValue('changeContractFilter')
    }
    const wrapper = shallow(
      <Contracts.WrappedComponent {...props} />
    );
    wrapper.instance().updateFilter = jest.fn().mockReturnValue('updateFilter');
    expect(wrapper.instance().updateFilter()).toBe('updateFilter');
    expect(wrapper.instance().props.fetchContracts()).toBe('fetchContracts')
    expect(wrapper.instance().props.changeContractFilter()).toBe('changeContractFilter');
  });

  test('filter with value', () => {
    const props = {
      filter: 'Greeter',
      contracts: {},
      fetchContracts: jest.fn(),
      changeContractFilter: jest.fn()
    }
    const wrapper = shallow(
      <Contracts.WrappedComponent {...props} />
    );
    expect(wrapper).toMatchSnapshot();
  });

  test('contracts with values', () => {
    const props = {
      filter: '',
      contracts: contracts,
      fetchContracts: jest.fn(),
      changeContractFilter: jest.fn()
    }
    const wrapper = shallow(
      <Contracts.WrappedComponent {...props} />
    );
    expect(wrapper).toMatchSnapshot();
  });

  test('search contract input', () => {
    const props = {
      filter: 'Greeter',
      contracts: {},
      chainIds: [],
      store: store,
      fetchContracts: jest.fn(),
      changeContractFilter: jest.fn(),
      fetchChainIds: jest.fn()
    }
    const wrapper = shallow(
      <Provider store={store}>
        <Contracts.WrappedComponent {...props} />
      </Provider>
    ).dive().dive().dive().dive();

    wrapper.find('input').at(0).simulate('change', { target: { value: "UPDATE" } });
    expect(props.changeContractFilter).toHaveBeenCalled();
    expect(props.changeContractFilter.mock.calls.length).toBe(2);
    expect(props.changeContractFilter.mock.calls).toMatchSnapshot();
  });

  test('mapStateToProps with default values', () => {
    const state = {
      contracts: {
        contracts: contracts,
        filter: 'Time'
      },
      chains: {
        selectedChain: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9",
        chainIds: chainIds
      },
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

})