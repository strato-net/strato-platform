import React from 'react';
import Account, { mapStateToProps } from '../../components/Account/index';
import { indexAccountsMock } from '../Accounts/accountsMock';
import { deepClone } from '../helper/testHelper';
import { accountDetails } from './accountMock';
import * as checkMode from '../../lib/checkMode';

describe('Account: index', () => {

  test('render with empty values', () => {
    const props = {
      account: accountDetails,
      name: '',
      address: '',
      faucetRequest: jest.fn()
    };

    checkMode.isModePublic = jest.fn().mockReturnValue(false);
    const wrapper = shallow(
      <Account.WrappedComponent {...props} />
    );

    expect(wrapper.debug()).toMatchSnapshot();
  });

  test('simulate click', () => {
    const props = {
      account: accountDetails,
      name: '',
      address: '',
      faucetRequest: jest.fn(),
      preventDefault: jest.fn(),
      stopPropagation: jest.fn()
    };

    checkMode.isModePublic = jest.fn().mockReturnValue(false);
    const wrapper = shallow(
      <Account.WrappedComponent {...props} />
    );

    wrapper.find('button').first().simulate('click', { preventDefault() { }, stopPropagation() { } })
    expect(props.faucetRequest).toHaveBeenCalled();
    expect(wrapper.debug()).toMatchSnapshot();
  });

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