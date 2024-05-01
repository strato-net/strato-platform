import React from 'react';
import Account, { mapStateToProps } from '../../components/Account/index';
import { indexAccountsMock } from '../Accounts/accountsMock';
import { accountDetails } from './accountMock';
import * as checkMode from '../../lib/checkMode';

describe('Account: index', () => {

  describe('renders correctly', () => {

    beforeAll(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(false);
    })

    test('with empty values', () => {
      const props = {
        account: accountDetails,
        name: '',
        address: '',
      };

      const wrapper = shallow(
        <Account.WrappedComponent {...props} />
      );
      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('with values', () => {
      const props = {
        account: accountDetails,
        name: '',
        address: '0004537908d44f458acb24b0f2c863ccd2bd3a13',
      };

      const wrapper = shallow(
        <Account.WrappedComponent {...props} />
      );
      expect(wrapper.debug()).toMatchSnapshot();

      // Testing that the leading zeroes are not truncated
      expect(wrapper.find('HexText').first().html()).toContain('<div class="pt-text-overflow-ellipsis">' + props.address)
    })
  })

  describe('mapStateToProps', () => {
    test('with values', () => {
      const state = {
        accounts: {
          accounts: indexAccountsMock,
        }
      }
      const ownProps = {
        name: 'Supplier1',
        address: '370adf114257cb0e0025eedf0a96261b51af23e3'
      }
      expect(mapStateToProps(state, ownProps)).toMatchSnapshot();
    });

    test('without values', () => {
      const state = {
        accounts: {
          accounts: indexAccountsMock,
        }
      }
      const ownProps = {
        name: 'Supply',
        address: '370adf114257cb0e0025eedf0a96261b51af23e3'
      }
      expect(mapStateToProps(state, ownProps)).toMatchSnapshot();
    });
  })

});