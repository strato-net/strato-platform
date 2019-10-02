import React from 'react';
import OauthAccounts, { mapStateToProps } from '../../../../components/Accounts/components/OauthAccounts';
import { oauthAccounts, filter } from '../../accountsMock';

describe('OauthAccounts: index', () => {

  describe('render with', () => {
    test('empty values', () => {
      const props = {
        oauthAccounts: [],
        filter: '',
        oauthAccountsFilter: jest.fn(),
        resetOauthUserAccount: jest.fn(),
        fetchOauthAccountDetail: jest.fn()
      }
      const wrapper = shallow(
        <OauthAccounts.WrappedComponent {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('mocked values', () => {
      const props = {
        oauthAccounts: oauthAccounts,
        filter: '',
        oauthAccountsFilter: jest.fn(),
        resetOauthUserAccount: jest.fn(),
        fetchOauthAccountDetail: jest.fn()
      }
      const wrapper = shallow(
        <OauthAccounts.WrappedComponent {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  test('open/hide account on click', () => {
    const props = {
      oauthAccounts: oauthAccounts,
      filter: '',
      oauthAccountsFilter: jest.fn(),
      resetOauthUserAccount: jest.fn(),
      fetchOauthAccountDetail: jest.fn()
    }
    const wrapper = shallow(
      <OauthAccounts.WrappedComponent {...props} />
    );

    // Open the account and test the data
    wrapper.find('div').at(14).simulate('click');
    expect(props.fetchOauthAccountDetail).toHaveBeenCalled();
    expect(props.fetchOauthAccountDetail).toHaveBeenCalledTimes(1);
    expect(props.resetOauthUserAccount).not.toHaveBeenCalled();

    // reset the opened account
    wrapper.find('div').at(14).simulate('click');
    expect(props.resetOauthUserAccount).toHaveBeenCalled();
  });

  test('invoke onchange on input and trigger changeAccountFilter', () => {
    const props = {
      oauthAccounts: oauthAccounts,
      filter: '',
      oauthAccountsFilter: jest.fn(),
      resetOauthUserAccount: jest.fn(),
      fetchOauthAccountDetail: jest.fn()
    }
    const wrapper = shallow(
      <OauthAccounts.WrappedComponent {...props} />
    );

    wrapper.find('input').simulate('change', { target: { name: "pollName", value: "spam" } });
    expect(props.oauthAccountsFilter).toHaveBeenCalled();
  });

  test('mapStateToProps with default values', () => {
    const state = {
      accounts: {
        oauthAccounts: oauthAccounts,
      },
      oauthAccounts: {
        filter: filter,
        account: oauthAccounts[0]
      },
      chains: {
        selectedChain: 'airline cartel 1'
      }
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

});