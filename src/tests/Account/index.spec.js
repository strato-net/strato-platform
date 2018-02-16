import React from 'react';
import Account, { mapStateToProps } from '../../components/Account/index';
import { indexAccountsMock } from '../Accounts/accountsMock';
import { deepClone } from '../helper/testHelper';
import { accountDetails } from './accountMock'

describe('Account: index', () => {

  test('render with empty values', () => {
    const props = {
      account: accountDetails,
      name: '',
      address: '',
      faucetRequest: jest.fn()
    }
    const wrapper = shallow(
      <Account.WrappedComponent {...props} />
    );
    expect(wrapper).toMatchSnapshot();
  });

  // test('simulate click', () => {
  //   const props = {
  //     account: accountDetails,
  //     name: '',
  //     address: '',
  //     faucetRequest: jest.fn(),
  //     preventDefault: jest.fn(),
  //     stopPropagation: jest.fn()
  //   }
  //   const wrapper = shallow(
  //     <Account.WrappedComponent {...props} />
  //   );
  //   wrapper.find('Button').simulate('click', { preventDefault() { }, stopPropagation() { } })
  //   expect(props.faucetRequest).toHaveBeenCalled()
  // });

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