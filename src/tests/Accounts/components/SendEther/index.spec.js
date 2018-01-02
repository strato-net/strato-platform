import React from 'react';
import SendEther, { mapStateToProps } from '../../../../components/Accounts/components/SendEther/index';
import { Provider } from 'react-redux';
import { reducer as formReducer } from 'redux-form';
import { createStore, combineReducers } from 'redux';
import { indexAccountsMock } from '../../accountsMock';

describe('Test SendEther index', () => {

  let store

  beforeEach(() => {
    store = createStore(combineReducers({ form: formReducer }))
  });

  test('should render component without values', () => {
    const props = {
      isOpen: false,
      result: null,
      accounts: [],
      fromUsername: '',
      toUsername: '',
      createDisabled: true,
      sendEtherOpenModal: jest.fn(),
      sendEtherCloseModal: jest.fn(),
      sendEther: jest.fn(),
      fetchAccounts: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <SendEther.WrappedComponent {...props} />
    ).dive().dive().dive();

    expect(wrapper).toMatchSnapshot();
  });

  test('should render component with values', () => {
    const props = {
      isOpen: true,
      result: null,
      accounts: indexAccountsMock,
      fromUsername: 'Admin_1177_49507',
      toUsername: 'User_1177_26292',
      createDisabled: false,
      sendEtherOpenModal: jest.fn(),
      sendEtherCloseModal: jest.fn(),
      sendEther: jest.fn(),
      fetchAccounts: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <SendEther.WrappedComponent {...props} />
    ).dive().dive().dive();

    expect(wrapper).toMatchSnapshot();
  });

  test('should open modal on click', () => {
    const props = {
      isOpen: true,
      result: null,
      accounts: indexAccountsMock,
      fromUsername: 'Admin_1177_49507',
      toUsername: 'User_1177_26292',
      createDisabled: false,
      sendEtherOpenModal: jest.fn(),
      sendEtherCloseModal: jest.fn(),
      sendEther: jest.fn(),
      fetchAccounts: jest.fn()
    };

    const wrapper = mount(
      <Provider store={store}>
        <SendEther.WrappedComponent {...props} />
      </Provider>
    );

    wrapper.find('Button').simulate('click');
    expect(props.sendEtherOpenModal).toHaveBeenCalled();
  });

  test('should close modal on click', () => {
    const props = {
      isOpen: true,
      result: null,
      accounts: indexAccountsMock,
      fromUsername: 'Admin_1177_49507',
      toUsername: 'User_1177_26292',
      createDisabled: false,
      sendEtherOpenModal: jest.fn(),
      sendEtherCloseModal: jest.fn(),
      sendEther: jest.fn(),
      fetchAccounts: jest.fn(),
      store: store
    };

    const wrapper = shallow(
      <SendEther.WrappedComponent {...props} />
    );

    const dialog = wrapper.dive().dive().dive().find('Dialog');
    dialog.find('Button').first().simulate('click');
    expect(props.sendEtherCloseModal).toHaveBeenCalled();
    expect(props.fetchAccounts).toHaveBeenCalled();
  });

  test('should test on submit form', () => {
    const props = {
      isOpen: true,
      result: null,
      accounts: indexAccountsMock,
      fromUsername: 'Admin_1177_49507',
      toUsername: 'User_1177_26292',
      createDisabled: false,
      sendEtherOpenModal: jest.fn(),
      sendEtherCloseModal: jest.fn(),
      sendEther: jest.fn(),
      fetchAccounts: jest.fn(),
      handleSubmit: jest.fn(),
      reset: jest.fn(),
      store: store
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
      <SendEther.WrappedComponent {...props} />
    );

    const dialog = wrapper.dive().dive().dive().find('Dialog').dive();
    dialog.find('Field').at(3).simulate('click');
    dialog.find('Field').at(4).simulate('click');
    expect(dialog.find('Field').at(3).props().checked).toBeTruthy();
    expect(dialog.find('Field').at(4).props().checked).toBeFalsy();

    dialog.find('Button').last().simulate('click');
    expect(props.handleSubmit).toHaveBeenCalled();
    wrapper.dive().dive().dive().instance().submit(values);
    expect(props.sendEther).toHaveBeenCalled();
  });

  test('test mapStateToProps function', () => {
    const state = {
      sendEther: {
        isOpen: true,
        result: 'On success we get result'
      },
      accounts: {
        accounts: indexAccountsMock
      }
    };

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});