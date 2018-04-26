import React from 'react';
import SendTokens, { mapStateToProps } from '../../../../components/Accounts/components/SendTokens/index';
import { Provider } from 'react-redux';
import { reducer as formReducer } from 'redux-form';
import { createStore, combineReducers } from 'redux';
import { indexAccountsMock } from '../../accountsMock';
import * as checkMode from '../../../../lib/checkMode';

describe('SendTokens: index', () => {

  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  });

  describe('render enterprise mode', () => {

    beforeEach(() => {
      checkMode.isModePublic = jest.fn().mockReturnValue(false);
    })

    test('without values', () => {
      const props = {
        isOpen: false,
        result: null,
        accounts: [],
        fromUsername: '',
        toUsername: '',
        createDisabled: true,
        sendTokensOpenModal: jest.fn(),
        sendTokensCloseModal: jest.fn(),
        sendTokens: jest.fn(),
        fetchAccounts: jest.fn(),
        store: store,
        initialValues: {
          from: '',
          fromAddress: ''
        },
        balance: undefined
      };

      const wrapper = shallow(
        <SendTokens.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        isOpen: true,
        result: null,
        accounts: indexAccountsMock,
        fromUsername: 'Admin_1177_49507',
        toUsername: 'User_1177_26292',
        createDisabled: false,
        sendTokensOpenModal: jest.fn(),
        sendTokensCloseModal: jest.fn(),
        sendTokens: jest.fn(),
        fetchAccounts: jest.fn(),
        store: store,
        initialValues: {
          from: 'Admin_1177_49507',
          fromAddress: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
        },
        balance: 10000000000
      };

      const wrapper = shallow(
        <SendTokens.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  describe('render public mode', () => {

    beforeEach(() => {
      checkMode.isModePublic = jest.fn().mockReturnValue(true);
    })

    test('without values', () => {
      const props = {
        isOpen: false,
        result: null,
        accounts: [],
        fromUsername: '',
        toUsername: '',
        createDisabled: true,
        sendTokensOpenModal: jest.fn(),
        sendTokensCloseModal: jest.fn(),
        sendTokens: jest.fn(),
        fetchAccounts: jest.fn(),
        store: store,
        initialValues: {
          from: '',
          fromAddress: ''
        },
        balance: undefined
      };

      const wrapper = shallow(
        <SendTokens.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        isOpen: true,
        result: null,
        accounts: indexAccountsMock,
        fromUsername: 'Admin_1177_49507',
        toUsername: 'User_1177_26292',
        createDisabled: false,
        sendTokensOpenModal: jest.fn(),
        sendTokensCloseModal: jest.fn(),
        sendTokens: jest.fn(),
        fetchAccounts: jest.fn(),
        store: store,
        initialValues: {
          from: 'Admin_1177_49507',
          fromAddress: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
        },
        balance: 10000000000
      };

      const wrapper = shallow(
        <SendTokens.WrappedComponent {...props} />
      ).dive().dive().dive();

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });


  test('open modal on click', () => {
    const props = {
      isOpen: true,
      result: null,
      accounts: indexAccountsMock,
      fromUsername: 'Admin_1177_49507',
      toUsername: 'User_1177_26292',
      createDisabled: false,
      sendTokensOpenModal: jest.fn(),
      sendTokensCloseModal: jest.fn(),
      sendTokens: jest.fn(),
      fetchAccounts: jest.fn(),
      fetchBalanceRequest: jest.fn(),
      initialValues: {
        from: 'Admin_1177_49507',
        fromAddress: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
      }
    };

    const wrapper = mount(
      <Provider store={store}>
        <SendTokens.WrappedComponent {...props} />
      </Provider>
    );

    wrapper.find('Button').simulate('click');
    expect(props.fetchBalanceRequest).toHaveBeenCalledWith(props.initialValues.fromAddress);
    expect(props.sendTokensOpenModal).toHaveBeenCalled();
  });

  test('close modal on click', () => {
    const props = {
      isOpen: true,
      result: null,
      accounts: indexAccountsMock,
      fromUsername: 'Admin_1177_49507',
      toUsername: 'User_1177_26292',
      createDisabled: false,
      sendTokensOpenModal: jest.fn(),
      sendTokensCloseModal: jest.fn(),
      sendTokens: jest.fn(),
      fetchAccounts: jest.fn(),
      store: store,
      initialValues: {
        from: 'Admin_1177_49507',
        fromAddress: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
      }
    };

    const wrapper = shallow(
      <SendTokens.WrappedComponent {...props} />
    );

    const dialog = wrapper.dive().dive().dive().find('Dialog');
    dialog.find('Button').first().simulate('click');
    expect(props.sendTokensCloseModal).toHaveBeenCalled();
    expect(props.fetchAccounts).toHaveBeenCalled();
  });

  test('simulate form fields and buttons', () => {
    const props = {
      isOpen: true,
      result: null,
      accounts: indexAccountsMock,
      fromUsername: 'Admin_1177_49507',
      toUsername: 'User_1177_26292',
      createDisabled: false,
      sendTokensOpenModal: jest.fn(),
      sendTokensCloseModal: jest.fn(),
      sendTokens: jest.fn(),
      fetchUserAddresses: jest.fn(),
      fetchAccounts: jest.fn(),
      handleSubmit: jest.fn(),
      reset: jest.fn(),
      store: store,
      initialValues: {
        from: 'Admin_1177_49507',
        fromAddress: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
      }
    };

    const values = {
      "from": "tanuj77",
      "fromAddress": "562a277d3b5ace17d92348c36f412622aaffafdb",
      "password": "pass",
      "to": "Buyer1",
      "toAddress": "044eda43ba9c76fc36b9183c96f7a8fad8d21fe6",
      "value": 1
    };

    const wrapper = shallow(
      <SendTokens.WrappedComponent {...props} />
    );

    const dialog = wrapper.dive().dive().dive().find('Dialog').dive();
    dialog.find('Field').at(0).simulate('change', { target: { value: 'Supplier1' } });
    expect(props.fetchUserAddresses).toHaveBeenCalled()

    dialog.find('Field').at(3).simulate('click');
    dialog.find('Field').at(4).simulate('click');
    expect(dialog.find('Field').at(3).props().checked).toBeTruthy();
    expect(dialog.find('Field').at(4).props().checked).toBeFalsy();

    dialog.find('Field').at(5).simulate('change', { target: { value: 'Supplier2' } });
    expect(props.fetchUserAddresses).toHaveBeenCalled()

    dialog.find('Button').last().simulate('click');
    expect(props.handleSubmit).toHaveBeenCalled();
    wrapper.dive().dive().dive().instance().submit(values);
    expect(props.sendTokens).toHaveBeenCalled();
  });

  test('mapStateToProps with default state', () => {
    const state = {
      sendTokens: {
        isOpen: true,
        result: 'On success we get result'
      },
      accounts: {
        accounts: indexAccountsMock,
        currentUserBalance: 10000000000
      },
      user: {
        currentUser: {
          username: 'Admin_1177_49507',
          accountAddress: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
        }
      }
    };

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});