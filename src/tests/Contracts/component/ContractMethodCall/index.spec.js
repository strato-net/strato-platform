import React from 'react';
import ContractMethodCall, { mapStateToProps } from '../../../../components/Contracts/components/ContractMethodCall/index';
import { reducer as formReducer } from 'redux-form'
import { createStore, combineReducers } from 'redux'
import { Provider } from 'react-redux';
import { modals, initialState } from './contractMethodCallMock';
import { indexAccountsMock } from '../../../Accounts/accountsMock'
import { Dialog } from '@blueprintjs/core';

describe('ContractMethodCall: index', () => {
  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  })

  test('renders contracts card with empty props', () => {
    const props = {
      modal: {},
      accounts: indexAccountsMock,
      modalUsername: 'Buyer1',
      currentUser: {
        "id": '',
        "username": '',
        "address": ''
      },
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

  test('mapStateToProps with default values', () => {
    const state = {
      methodCall: {
        modals: undefined
      },
      user: {
        "username": null,
        "currentUser": {
          "id": 6,
          "username": "tanuj41",
          "address": "86ee0c9644611495c0a1b1074e40d4e6db2f6b26"
        },
        "isLoggedIn": true,
        "error": null,
        "isOpen": false,
        "spinning": false
      },
      accounts: indexAccountsMock
    }
    expect(mapStateToProps(state, 'methodCallgreetf62c8965f2129d178aa28c043f9b3d0cd52f9e2e')).toMatchSnapshot();
  });

  test('open modal', () => {
    const props = {
      modal: modals,
      accounts: indexAccountsMock,
      modalUsername: 'Buyer1',
      currentUser: {
        "id": 6,
        "username": "tanuj41",
        "address": "86ee0c9644611495c0a1b1074e40d4e6db2f6b26"
      },
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

  test('modal close', () => {
    const props = {
      modal: modals,
      accounts: indexAccountsMock,
      modalUsername: 'Buyer1',
      currentUser: {
        "id": 6,
        "username": "tanuj41",
        "address": "86ee0c9644611495c0a1b1074e40d4e6db2f6b26"
      },
      methodCallFetchArgs: jest.fn(),
      methodCallOpenModal: jest.fn(),
      methodCallCloseModal: jest.fn(),
      fetchAccounts: jest.fn(),
      methodCall: jest.fn(),
      store: store
    }
    const wrapper = shallow(
      <Provider store={store}>
        <ContractMethodCall.WrappedComponent {...props} />
      </Provider>
    ).dive().dive().dive().dive();
    wrapper.find('Button').at(1).simulate('click', { preventDefault() { }, stopPropagation() { } })
    expect(props.methodCallCloseModal).toHaveBeenCalled();
  });

  test('simulate submit form', () => {
    const props = {
      modal: modals,
      accounts: indexAccountsMock,
      modalUsername: 'Buyer1',
      currentUser: {
        "id": 6,
        "username": "tanuj41",
        "address": "86ee0c9644611495c0a1b1074e40d4e6db2f6b26"
      },
      methodCallFetchArgs: jest.fn(),
      methodCallOpenModal: jest.fn(),
      methodCallCloseModal: jest.fn(),
      fetchAccounts: jest.fn(),
      methodCall: jest.fn(),
      store: store
    }
    const wrapper = shallow(
      <Provider store={store}>
        <ContractMethodCall.WrappedComponent {...props} />
      </Provider>
    ).dive().dive().dive().dive();
    wrapper.find('button').simulate('click')
    expect(props.methodCall).toHaveBeenCalled();
  });

});


