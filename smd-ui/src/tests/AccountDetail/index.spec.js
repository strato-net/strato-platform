import React from 'react';
import AccountDetail, { mapStateToProps } from '../../components/AccountDetail';
import { accountDetails } from '../Account/accountMock';
import * as checkMode from '../../lib/checkMode';

describe('Account: index', () => {

  describe('renders correctly (Oauth) ', () => {

    beforeAll(() => {
      checkMode.isModeOauth = jest.fn().mockReturnValue(false);
    })

    test('with empty values', () => {
      const props = {
        account: {},
        faucet: {
          accountAddress: null
        }
      };

      const wrapper = shallow(
        <AccountDetail.WrappedComponent {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        oauthAccount: accountDetails[0],
        account: accountDetails[0],
        faucet: {
          accountAddress: accountDetails[0].address,
          status: false
        }
      };

      const wrapper = shallow(
        <AccountDetail.WrappedComponent {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });
  });

  describe('renders correctly (non-oauth)', () => {

    beforeAll(() => {
      checkMode.isModeOauth = jest.fn().mockReturnValue(false);
    })

    test('with empty values', () => {
      const props = {
        account: {},
        faucet: {
          accountAddress: null
        }
      };

      const wrapper = shallow(
        <AccountDetail.WrappedComponent {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        account: accountDetails[0],
        faucet: {
          accountAddress: accountDetails[0].address,
          status: false
        }
      };

      const wrapper = shallow(
        <AccountDetail.WrappedComponent {...props} />
      );

      expect(wrapper.debug()).toMatchSnapshot();
    });
  });

  describe('mapStateToProps', () => {
    test('with values', () => {
      const state = {
        accounts: { currentAccountDetail: accountDetails[0] },
        oauthAccounts: {
          name: 'name',
          faucet: {
            accountAddress: '5d04537908d44f458acb24b0f2c863ccd2bd3a13',
            status: true
          },
          account: accountDetails[0]
        },
        chains: {
          selectedChain: 'ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9'
        }
      };

      expect(mapStateToProps(state)).toMatchSnapshot();
    });

    test('without values', () => {
      const state = {
        accounts: { currentAccountDetail: null },
        oauthAccounts: {
          name: null,
          faucet: {
            accountAddress: null,
            status: true
          },
          account: null
        },
        chains: {
          selectedChain: null
        }
      };

      expect(mapStateToProps(state)).toMatchSnapshot();
    });
  });

});