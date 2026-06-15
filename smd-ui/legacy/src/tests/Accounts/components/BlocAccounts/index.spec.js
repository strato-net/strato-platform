import React from 'react';
import BlocAccounts, { mapStateToProps } from '../../../../components/Accounts/components/BlocAccounts';
import { indexAccountsMock, filter } from '../../accountsMock';

describe('BlocAccounts: index', () => {

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
        <BlocAccounts.WrappedComponent {...props} />
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
        <BlocAccounts.WrappedComponent {...props} />
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
      <BlocAccounts.WrappedComponent {...props} />
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
      <BlocAccounts.WrappedComponent {...props} />
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
      <BlocAccounts.WrappedComponent {...props} />
    );

    wrapper.find('input').simulate('change', { target: { name: "pollName", value: "spam" } });
    expect(props.changeAccountFilter).toHaveBeenCalled();
  });

  test('mapStateToProps with default values', () => {
    const state = {
      accounts: {
        faucet: {
          address: 'd2263b71c14010ff03d8f786670aba691b22b158',
          status: false,
        },
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