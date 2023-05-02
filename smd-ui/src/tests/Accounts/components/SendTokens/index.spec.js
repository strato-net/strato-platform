import React from 'react';
import SendTokens, { mapStateToProps } from '../../../../components/Accounts/components/SendTokens/index';
import { Provider } from 'react-redux';
import { reducer as formReducer } from 'redux-form';
import { createStore, combineReducers } from 'redux';
import { indexAccountsMock } from '../../accountsMock';
import * as checkMode from '../../../../lib/checkMode';
import { chain } from '../../../Chains/chainsMock';

describe('SendTokens: index', () => {

  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  });

  xdescribe('render non oauth mode', () => {

    beforeEach(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(false);
    })

    test('without values', () => {
      const props = {
        isOpen: false,
        result: null,
        accounts: [],
        fromUsername: '',
        toUsername: '',
        createDisabled: true,
        chainLabel: {},
        chainLabelIds: [],
        sendTokensOpenModal: jest.fn(),
        sendTokensCloseModal: jest.fn(),
        sendTokens: jest.fn(),
        fetchAccounts: jest.fn(),
        fetchChainIds: jest.fn(),
        getLabelIds: jest.fn(),
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
        chainLabel: chain,
        chainLabelIds: ['75dc24995abf63fe7d637b4879353a41593ef05c37ee6d11704bb97403306a86', '8eeefc708630002bb349ce1e1f914ac3adf8efc385106a1ef04b90c3d9b7ee60'],
        sendTokensOpenModal: jest.fn(),
        sendTokensCloseModal: jest.fn(),
        sendTokens: jest.fn(),
        fetchAccounts: jest.fn(),
        fetchChainIds: jest.fn(),
        getLabelIds: jest.fn(),
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

    test('simulate form fields and buttons', () => {
      const props = {
        isOpen: true,
        result: null,
        accounts: indexAccountsMock,
        fromUsername: 'Admin_1177_49507',
        toUsername: 'User_1177_26292',
        createDisabled: false,
        chainLabel: chain,
        chainLabelIds: ['75dc24995abf63fe7d637b4879353a41593ef05c37ee6d11704bb97403306a86', '8eeefc708630002bb349ce1e1f914ac3adf8efc385106a1ef04b90c3d9b7ee60'],
        sendTokensOpenModal: jest.fn(),
        sendTokensCloseModal: jest.fn(),
        sendTokens: jest.fn(),
        fetchUserAddresses: jest.fn(),
        fetchAccounts: jest.fn(),
        handleSubmit: jest.fn(),
        reset: jest.fn(),
        fetchChainIds: jest.fn(),
        getLabelIds: jest.fn(),
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
      dialog.find('Field').at(0).simulate('change', { target: { value: 'airline cartel 9' } });
      dialog.find('Field').at(1).simulate('change', { target: { value: '75dc24995abf63fe7d637b4879353a41593ef05c37ee6d11704bb97403306a86' } });
      dialog.find('Field').at(2).simulate('change', { target: { value: 'Supplier1' } });
      expect(props.fetchUserAddresses).toHaveBeenCalled()

      dialog.find('Field').at(5).simulate('click');
      dialog.find('Field').at(6).simulate('click');
      expect(dialog.find('Field').at(5).props().checked).toBeTruthy();
      expect(dialog.find('Field').at(6).props().checked).toBeFalsy();

      dialog.find('Field').at(7).simulate('change', { target: { value: 'Supplier2' } });
      expect(props.fetchUserAddresses).toHaveBeenCalled()

      dialog.find('Button').last().simulate('click');
      expect(props.handleSubmit).toHaveBeenCalled();
      wrapper.dive().dive().dive().instance().submit(values);
      expect(props.sendTokens).toHaveBeenCalled();
    });

    test('close modal on click', () => {
      const props = {
        isOpen: true,
        result: null,
        accounts: indexAccountsMock,
        fromUsername: 'Admin_1177_49507',
        toUsername: 'User_1177_26292',
        createDisabled: false,
        chainLabel: chain,
        chainLabelIds: ['75dc24995abf63fe7d637b4879353a41593ef05c37ee6d11704bb97403306a86', '8eeefc708630002bb349ce1e1f914ac3adf8efc385106a1ef04b90c3d9b7ee60'],
        sendTokensOpenModal: jest.fn(),
        sendTokensCloseModal: jest.fn(),
        sendTokens: jest.fn(),
        fetchAccounts: jest.fn(),
        fetchChainIds: jest.fn(),
        getLabelIds: jest.fn(),
        store: store,
        initialValues: {
          from: 'Admin_1177_49507',
          fromAddress: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
        },
        userCertificate: { userAddress: "456789" }
      };

      const wrapper = shallow(
        <SendTokens.WrappedComponent {...props} />
      );

      const dialog = wrapper.dive().dive().dive().find('Dialog');
      dialog.find('AnchorButton').first().simulate('click');
      expect(props.sendTokensCloseModal).toHaveBeenCalled();
      expect(props.fetchAccounts).toHaveBeenCalled();
    });
  });

  describe('render Oauth mode', () => {

    beforeEach(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(true);
    })

    test('without values', () => {
      const props = {
        isOpen: false,
        result: null,
        accounts: [],
        fromUsername: '',
        toUsername: '',
        createDisabled: true,
        chainLabel: chain,
        chainLabelIds: ['75dc24995abf63fe7d637b4879353a41593ef05c37ee6d11704bb97403306a86', '8eeefc708630002bb349ce1e1f914ac3adf8efc385106a1ef04b90c3d9b7ee60'],
        sendTokensOpenModal: jest.fn(),
        sendTokensCloseModal: jest.fn(),
        sendTokens: jest.fn(),
        fetchAccounts: jest.fn(),
        fetchChainIds: jest.fn(),
        getLabelIds: jest.fn(),
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
        chainLabel: chain,
        chainLabelIds: ['75dc24995abf63fe7d637b4879353a41593ef05c37ee6d11704bb97403306a86', '8eeefc708630002bb349ce1e1f914ac3adf8efc385106a1ef04b90c3d9b7ee60'],
        sendTokensOpenModal: jest.fn(),
        sendTokensCloseModal: jest.fn(),
        sendTokens: jest.fn(),
        fetchAccounts: jest.fn(),
        fetchChainIds: jest.fn(),
        getLabelIds: jest.fn(),
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
      chainLabel: chain,
      chainLabelIds: ['75dc24995abf63fe7d637b4879353a41593ef05c37ee6d11704bb97403306a86', '8eeefc708630002bb349ce1e1f914ac3adf8efc385106a1ef04b90c3d9b7ee60'],
      sendTokensOpenModal: jest.fn(),
      sendTokensCloseModal: jest.fn(),
      sendTokens: jest.fn(),
      fetchAccounts: jest.fn(),
      fetchBalanceRequest: jest.fn(),
      fetchChainIds: jest.fn(),
      getLabelIds: jest.fn(),
      initialValues: {
        from: 'Admin_1177_49507',
        fromAddress: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
      },
      userCertificate: { userAddress: "456789"}
    };

    const wrapper = mount(
      <Provider store={store}>
        <SendTokens.WrappedComponent {...props} />
      </Provider>
    );

    wrapper.find('AnchorButton').simulate('click');
    expect(props.fetchBalanceRequest).toHaveBeenCalledWith(props.initialValues.fromAddress);
    expect(props.sendTokensOpenModal).toHaveBeenCalled();
  });

  test('simulate form fields and buttons', () => {
    const props = {
      isOpen: true,
      result: null,
      accounts: indexAccountsMock,
      fromUsername: 'Admin_1177_49507',
      toUsername: 'User_1177_26292',
      createDisabled: false,
      chainLabel: chain,
      chainLabelIds: ['75dc24995abf63fe7d637b4879353a41593ef05c37ee6d11704bb97403306a86', '8eeefc708630002bb349ce1e1f914ac3adf8efc385106a1ef04b90c3d9b7ee60'],
      sendTokensOpenModal: jest.fn(),
      sendTokensCloseModal: jest.fn(),
      sendTokens: jest.fn(),
      fetchUserAddresses: jest.fn(),
      fetchAccounts: jest.fn(),
      handleSubmit: jest.fn(),
      reset: jest.fn(),
      fetchChainIds: jest.fn(),
      getLabelIds: jest.fn(),
      store: store,
      initialValues: {
        from: 'Admin_1177_49507',
        fromAddress: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
      },
      userCertificate: { userAddress: "456789"}
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
    dialog.find('Field').at(0).simulate('change', { target: { value: 'airline cartel 9' } });
    dialog.find('Field').at(1).simulate('change', { target: { value: '75dc24995abf63fe7d637b4879353a41593ef05c37ee6d11704bb97403306a86' } });
    expect(dialog.find('Field').at(2).props().disabled).toBe(true);
    expect(dialog.find('Field').at(3).props().disabled).toBe(true);
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
      chains: {
        listChain: chain,
        listLabelIds: ['79f69ec8f4bdb4a0c43e8970e4f2a9701db43b8b7b046023fe2a874ddb32acae']
      },
      user: {
        oauthUser: {
          username: 'Admin_1177_49507',
          address: '0bdd9ade6477ba753650cc5d9ce40a17c42246c1'
        }
      }
    };

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});