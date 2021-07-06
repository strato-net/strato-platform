import React from 'react';
import Accounts, { mapStateToProps } from '../../components/Accounts';
import { filter, indexAccountsMock } from './accountsMock';
import * as checkMode from '../../lib/checkMode';

describe('Accounts: index', () => {

  describe('render (Oauth enabled)', () => {

    beforeAll(() => {
      checkMode.isModeOauth = jest.fn().mockReturnValue(true);
    })

    test('empty values', () => {
      const props = {
        accounts: [],
        filter: '',
        history: {},
        fetchAccounts: jest.fn(),
        changeAccountFilter: jest.fn(),
        faucetRequest: jest.fn(),
        resetUserAddress: jest.fn(),
        fetchUserAddresses: jest.fn(),
        fetchOauthAccounts : jest.fn()
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
        fetchUserAddresses: jest.fn(),
        fetchOauthAccounts : jest.fn()
      }
      const wrapper = shallow(
        <Accounts.WrappedComponent {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  describe('render (Non-Oauth)', () => {

    beforeAll(() => {
      checkMode.isModeOauth = jest.fn().mockReturnValue(false);
    })

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
        fetchUserAddresses: jest.fn(),
        fetchOauthAccounts : jest.fn()
      }
      const wrapper = shallow(
        <Accounts.WrappedComponent {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });

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
      fetchUserAddresses: jest.fn(),
      fetchOauthAccounts : jest.fn()
    }

    shallow(
      <Accounts.WrappedComponent {...props} />
    );

    expect(props.fetchAccounts).toHaveBeenCalled();
    expect(props.fetchAccounts.mock.calls).toEqual([[true, true, props.selectedChain]]);
  });

  test('componentDidMount OauthEnabled', () => {
    checkMode.isOauthEnabled = jest.fn().mockReturnValue(true);
    const props = {
      accounts: indexAccountsMock,
      filter: filter,
      history: {},
      selectedChain: 'airline cartel 1',
      fetchAccounts: jest.fn(),
      changeAccountFilter: jest.fn(),
      faucetRequest: jest.fn(),
      resetUserAddress: jest.fn(),
      fetchUserAddresses: jest.fn(),
      fetchOauthAccounts: jest.fn()
    }

    shallow(
      <Accounts.WrappedComponent {...props} />
    );

    expect(props.fetchOauthAccounts).toHaveBeenCalled();
    expect(props.fetchOauthAccounts.mock.calls).toEqual([[]]);
  });

  test('mapStateToProps with default values', () => {
    const state = {}
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});