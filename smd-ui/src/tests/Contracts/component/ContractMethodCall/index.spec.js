import React from 'react';
import ContractMethodCall, { mapStateToProps, validate } from '../../../../components/Contracts/components/ContractMethodCall/index';
import { reducer as formReducer } from 'redux-form'
import { createStore, combineReducers } from 'redux'
import { Provider } from 'react-redux';
import { modals } from './contractMethodCallMock';
import { indexAccountsMock } from '../../../Accounts/accountsMock'
import * as checkMode from '../../../../lib/checkMode';
import { chain } from '../../../Chains/chainsMock';

describe('ContractMethodCall: index', () => {
  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  })

  test('renders contracts card (enterprise mode)', () => {
    const props = {
      modal: {},
      accounts: indexAccountsMock,
      modalUsername: 'Buyer1',
      currentUser: {
        "id": '',
        "username": '',
        "address": ''
      },
      chainLabel: chain,
      chainLabelIds: chain["airline cartel 9"],
      fetchChainIds: jest.fn(),
      getLabelIds: jest.fn(),
      methodCallFetchArgs: jest.fn(),
      methodCallOpenModal: jest.fn(),
      methodCallCloseModal: jest.fn(),
      fetchAccounts: jest.fn(),
      methodCall: jest.fn(),
      store: store
    }

    checkMode.isModePublic = jest.fn().mockReturnValue(false);

    const wrapper = shallow(
      <ContractMethodCall.WrappedComponent {...props} />
    ).dive().dive().dive();

    expect(wrapper.debug()).toMatchSnapshot();
  });

  test('renders contracts card (public mode)', () => {
    const props = {
      modal: {},
      accounts: {},
      modalUsername: 'Buyer1',
      chainLabel: chain,
      chainLabelIds: chain["airline cartel 9"],
      currentUser: {
        "id": '',
        "username": 'Supplier1',
        "address": '370adf114257cb0e0025eedf0a96261b51af23e3'
      },
      fetchChainIds: jest.fn(),
      getLabelIds: jest.fn(),
      methodCallFetchArgs: jest.fn(),
      methodCallOpenModal: jest.fn(),
      methodCallCloseModal: jest.fn(),
      fetchAccounts: jest.fn(),
      methodCall: jest.fn(),
      store: store
    }

    checkMode.isModePublic = jest.fn().mockReturnValue(true);

    const wrapper = shallow(
      <ContractMethodCall.WrappedComponent {...props} />
    ).dive().dive().dive();

    expect(wrapper.debug()).toMatchSnapshot();
  });

  test('mapStateToProps with default values', () => {
    const state = {
      methodCall: {
        modals: undefined
      },
      chains: {
        listChain: chain,
        listLabelIds: chain["airline cartel 9"]
      },
      user: {
        "username": null,
        "currentUser": {
          "id": 6,
          "username": "tanuj41",
          "accountAddress": "86ee0c9644611495c0a1b1074e40d4e6db2f6b26"
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
      chainLabel: chain,
      chainLabelIds: chain["airline cartel 9"],
      fetchChainIds: jest.fn(),
      getLabelIds: jest.fn(),
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
      chainLabel: chain,
      chainLabelIds: chain["airline cartel 9"],
      fetchChainIds: jest.fn(),
      getLabelIds: jest.fn(),
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
      chainLabel: chain,
      chainLabelIds: chain["airline cartel 9"],
      fetchChainIds: jest.fn(),
      getLabelIds: jest.fn(),
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

  test('validate', () => {
    const values = {
      username: '',
      address: null,
      password: null
    }

    expect(validate(values)).toMatchSnapshot();
  });

});


