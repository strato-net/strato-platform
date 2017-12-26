import React from 'react';
import SendEther, { mapStateToProps } from '../../../../components/Accounts/components/SendEther/index';
import { Provider } from 'react-redux';
import configureStore from 'redux-mock-store';
import { reducerAccounts } from '../../accountsMock';

const mockStore = configureStore([]);

describe('Test SendEther index', () => {

  test('should render component without values', () => {
    const props = {
      isOpen: false,
      result: null,
      accounts: reducerAccounts,
      sendEtherOpenModal: () => { },
      sendEtherCloseModal: () => { },
      sendEther: () => { },
      fetchAccounts: () => { }
    };

    const store = mockStore({});
    const wrapper = render(
      <Provider store={store}>
        <SendEther.WrappedComponent {...props} />
      </Provider>
    );

    expect(wrapper).toMatchSnapshot();

  });

  test('should open modal on click', () => {
    const props = {
      isOpen: true,
      result: null,
      accounts: reducerAccounts,
      fromUsername: 'Admin_1177_49507',
      toUsername: 'User_1177_26292',
      sendEtherOpenModal: jest.fn(),
      sendEtherCloseModal: () => { },
      sendEther: () => { },
      fetchAccounts: () => { }
    };

    const store = mockStore({});

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
      accounts: reducerAccounts,
      fromUsername: 'Admin_1177_49507',
      toUsername: 'User_1177_26292',
      sendEtherOpenModal: jest.fn(),
      sendEtherCloseModal: jest.fn(),
      sendEther: () => { },
      fetchAccounts: jest.fn()
    };

    const store = mockStore({});

    const wrapper = mount(
      <Provider store={store}>
        <SendEther.WrappedComponent {...props} />
      </Provider>
    );

    wrapper.find('Dialog').get(0).props.onClose();
    expect(props.sendEtherCloseModal).toHaveBeenCalled();
    expect(props.fetchAccounts).toHaveBeenCalled();
  });

  test('test mapStateToProps function', () => {
    const state = {
      sendEther: {
        isOpen: true,
        result: 'On success we get result'
      },
      accounts: {
        accounts: reducerAccounts
      }
    };

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});