import {
  fetchAccounts,
  fetchAccountsSuccess,
  fetchAccountsFailure,
  changeAccountFilter,
  fetchUserAddresses,
  fetchUserAddressesSuccess,
  fetchUserAddressesFailure,
  fetchAccountDetail,
  fetchAccountDetailSuccess,
  fetchAccountDetailFailure,
  faucetRequest,
  faucetSuccess,
  faucetFailure
} from '../../components/Accounts/accounts.actions';
import { accountsMock, accountDetail, error } from './accountsMock';

describe('Accounts: action', () => {

  describe('fetch accounts', () => {
    test('request', () => {
      const data = {
        loadAddresses: true,
        loadBalances: true
      }
      expect(fetchAccounts(data.loadAddresses, data.loadBalances)).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchAccountsSuccess(accountsMock)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchAccountsFailure(error)).toMatchSnapshot();
    });
  })


  test('change account filter', () => {
    let filter = 'search accounts';
    expect(changeAccountFilter(filter)).toMatchSnapshot();
  });

  describe('fetch user addresses', () => {

    test('request', () => {
      let data = {
        name: 'tanuj',
        loadBalances: true
      };
      expect(fetchUserAddresses(data.name, data.loadBalances)).toMatchSnapshot();
    });

    test('success', () => {
      let data = {
        name: 'tanuj',
        address: '76a3192ce9aa0531fe7e0e3489a469018c0bff03'
      };
      expect(fetchUserAddressesSuccess(data.name, data.address)).toMatchSnapshot();
    });

    test('failure', () => {
      let data = {
        name: 'tanuj',
        error
      };
      expect(fetchUserAddressesFailure(data.name, data.error)).toMatchSnapshot();
    });

  })

  describe('fetch account detail', () => {

    test('request', () => {
      let data = {
        name: 'tanuj',
        address: '76a3192ce9aa0531fe7e0e3489a469018c0bff03'
      };
      expect(fetchAccountDetail(data.name, data.address)).toMatchSnapshot();
    });

    test('success', () => {
      let data = {
        name: 'tanuj',
        address: '76a3192ce9aa0531fe7e0e3489a469018c0bff03',
        detail: accountDetail
      };
      expect(fetchAccountDetailSuccess(data.name, data.address, data.detail)).toMatchSnapshot();
    });

    test('failure', () => {
      let data = {
        name: 'tanuj',
        address: '76a3192ce9aa0531fe7e0e3489a469018c0bff03',
        error
      };
      expect(fetchAccountDetailFailure(data.name, data.address, data.error)).toMatchSnapshot();
    });

  })

  describe('fetch faucet', () => {

    test('request', () => {
      let data = {
        name: 'tanuj',
        address: '76a3192ce9aa0531fe7e0e3489a469018c0bff03'
      };
      expect(faucetRequest(data.name, data.address)).toMatchSnapshot();
    });

    test('success', () => {
      expect(faucetSuccess()).toMatchSnapshot();
    });

    test('failure', () => {
      expect(faucetFailure(error)).toMatchSnapshot();
    });

  })

});