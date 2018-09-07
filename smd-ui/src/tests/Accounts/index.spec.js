import React from 'react';
import Accounts, { mapStateToProps } from '../../components/Accounts';
import { filter, indexAccountsMock } from './accountsMock';

describe('Accounts: index', () => {

  describe('render with', () => {
    test('empty values', () => {
      const props = {
        accounts: [],
        filter: '',
        history: {},
        fetchAccounts: jest.fn(),
        changeAccountFilter: jest.fn(),
        faucetRequest: jest.fn(),
        resetUserAddress: jest.fn(),
        fetchUserAddresses: jest.fn()
      }
      const wrapper = shallow(
        <Accounts.WrappedComponent {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('mocked values', () => {
      const props = {
        accounts: indexAccountsMock,
        filter: '',
        history: {},
        fetchAccounts: jest.fn(),
        changeAccountFilter: jest.fn(),
        faucetRequest: jest.fn(),
        resetUserAddress: jest.fn(),
        fetchUserAddresses: jest.fn()
      }
      const wrapper = shallow(
        <Accounts.WrappedComponent {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  test('hide account on click', () => {
    const props = {
      accounts: indexAccountsMock,
      filter: '',
      history: {},
      fetchAccounts: jest.fn(),
      changeAccountFilter: jest.fn(),
      faucetRequest: jest.fn(),
      resetUserAddress: jest.fn(),
      fetchUserAddresses: jest.fn()
    };

    const wrapper = shallow(
      <Accounts.WrappedComponent {...props} />
    );

    wrapper.find('div').at(14).simulate('click');
    expect(props.resetUserAddress).toHaveBeenCalled();
    expect(props.resetUserAddress).toHaveBeenCalledTimes(1);
    expect(props.fetchUserAddresses).not.toHaveBeenCalled();
  });

  test('open account on click', () => {
    const props = {
      accounts: indexAccountsMock,
      filter: '',
      history: { push: jest.fn() },
      fetchAccounts: jest.fn(),
      changeAccountFilter: jest.fn(),
      faucetRequest: jest.fn(),
      resetUserAddress: jest.fn(),
      fetchUserAddresses: jest.fn()
    }
    const wrapper = shallow(
      <Accounts.WrappedComponent {...props} />
    );

    wrapper.find('div').at(59).simulate('click');
    expect(props.fetchUserAddresses).toHaveBeenCalled();
    expect(props.fetchUserAddresses).toHaveBeenCalledTimes(1);
    expect(props.resetUserAddress).not.toHaveBeenCalled();
  });

  test('invoke onchange on input and trigger changeAccountFilter', () => {
    const props = {
      accounts: indexAccountsMock,
      filter: '',
      history: { push: jest.fn() },
      fetchAccounts: jest.fn(),
      changeAccountFilter: jest.fn(),
      faucetRequest: jest.fn(),
      resetUserAddress: jest.fn(),
      fetchUserAddresses: jest.fn()
    }
    const wrapper = shallow(
      <Accounts.WrappedComponent {...props} />
    );
    wrapper.find('input').simulate('change', { target: { name: "pollName", value: "spam" } });
    expect(props.changeAccountFilter).toHaveBeenCalled();
  });

  test('componentDidMount', () => {
    const props = {
      accounts: indexAccountsMock,
      filter: filter,
      history: {},
      selectedChain: 'airline cartel 1',
      fetchAccounts: jest.fn(),
      changeAccountFilter: jest.fn(),
      faucetRequest: jest.fn(),
      resetUserAddress: jest.fn(),
      fetchUserAddresses: jest.fn()
    }
    const wrapper = shallow(
      <Accounts.WrappedComponent {...props} />
    );
    expect(props.fetchAccounts).toHaveBeenCalled();
    expect(props.fetchAccounts.mock.calls).toEqual([[true, true, props.selectedChain]]);
  });

  test('mapStateToProps with default values', () => {
    const state = {
      accounts: {
        accounts: indexAccountsMock,
        filter: filter,
      },
      chains: {
        selectedChain: 'airline cartel 1'
      }
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});