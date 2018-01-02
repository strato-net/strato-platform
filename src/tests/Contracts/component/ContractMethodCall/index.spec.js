import React from 'react';
import ContractMethodCall, { mapStateToProps } from '../../../../components/Contracts/components/ContractMethodCall/index';
import { reducer as formReducer } from 'redux-form'
import { createStore, combineReducers } from 'redux'
import { Provider } from 'react-redux';
import { modals, initialState } from './contractMethodCallMock';
import { indexAccountsMock } from '../../../Accounts/accountsMock'
import { Dialog } from '@blueprintjs/core';

describe('Test ContractMethodCall index', () => {
  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  })

  test('renders contracts card with empty props', () => {
    const props = {
      modal: {},
      accounts: indexAccountsMock,
      modalUsername: 'Buyer1',
      methodCallFetchArgs: jest.fn(),
      methodCallOpenModal: jest.fn(),
      methodCallCloseModal: jest.fn(),
      fetchAccounts: jest.fn(),
      methodCall: jest.fn(),
    }
    const wrapper = render(
      <Provider store={store}>
        <ContractMethodCall.WrappedComponent {...props} />
      </Provider>
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should test mapStateToProps function', () => {
    const state = {
      methodCall: {
        modals: undefined
      },
      accounts: indexAccountsMock
    }

    expect(mapStateToProps(state, 'methodCallgreetf62c8965f2129d178aa28c043f9b3d0cd52f9e2e')).toMatchSnapshot();
  });

  test('should open model on button click', () => {
    const props = {
      modal: modals,
      accounts: indexAccountsMock,
      modalUsername: 'Buyer1',
      methodCallFetchArgs: jest.fn(),
      methodCallOpenModal: jest.fn(),
      methodCallCloseModal: jest.fn(),
      fetchAccounts: jest.fn(),
      methodCall: jest.fn(),
    }

    const wrapper = mount(
      <Provider store={store}>
        <ContractMethodCall.WrappedComponent {...props} />
      </Provider>
    );

    wrapper.find('Button').simulate('click');
    expect(props.methodCallOpenModal).toHaveBeenCalled();
  });

  test('should onClose work correctly on outside click', () => { 
    const props = {
      modal: modals,
      accounts: indexAccountsMock,
      modalUsername: 'Buyer1',
      methodCallFetchArgs: jest.fn(),
      methodCallOpenModal: jest.fn(),
      methodCallCloseModal: jest.fn(),
      fetchAccounts: jest.fn(),
      methodCall: jest.fn(),
      store:store
    }
    const wrapper = shallow(
      <Provider store={store}>
        <ContractMethodCall.WrappedComponent {...props} />
      </Provider>
    ).dive().dive().dive().dive();

    wrapper.find('Button').at(1).simulate('click', { preventDefault() {}, stopPropagation() {} })
    expect(props.methodCallCloseModal).toHaveBeenCalled();
  });

  test('should submit form', () => {
    const props = {
      modal: modals,
      accounts: indexAccountsMock,
      modalUsername: 'Buyer1',
      methodCallFetchArgs: jest.fn(),
      methodCallOpenModal: jest.fn(),
      methodCallCloseModal: jest.fn(),
      fetchAccounts: jest.fn(),
      methodCall: jest.fn(),
      store:store
    }
    console.log('Lets see here', modals)
    
    const wrapper = shallow(
      <Provider store={store}>
        <ContractMethodCall.WrappedComponent {...props} />
      </Provider>
    ).dive().dive().dive().dive();

    console.log('OLolo',wrapper.find('button').debug())
    wrapper.find('button').simulate('click')
    expect(props.methodCall).toHaveBeenCalled();
  });

});


