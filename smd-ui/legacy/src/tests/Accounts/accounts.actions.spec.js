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
  resetUserAddress,
  fetchBalanceRequest,
  fetchBalanceSuccess,
  fetchBalanceFailure,
  fetchCurrentAccountDetail,
  fetchCurrentAccountDetailSuccess,
  fetchCurrentAccountDetailFailure,
  fetchOauthAccounts,
  fetchOauthAccountsSuccess,
  fetchOauthAccountsFailure
} from '../../components/Accounts/accounts.actions';
import { accountsMock, accountDetail, error, oauthAccounts } from './accountsMock';

describe('Accounts: action', () => {

  describe('fetch accounts', () => {
    test('request', () => {
      const data = {
        loadAddresses: true,
        loadBalances: true,
        chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9"
      }
      expect(fetchAccounts(data.loadAddresses, data.loadBalances, data.chainId)).toMatchSnapshot();
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
        loadBalances: true,
        chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9"
      };
      expect(fetchUserAddresses(data.name, data.loadBalances, data.chainId)).toMatchSnapshot();
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

    test('reset user', () => {
      let data = {
        name: 'Bid'
      };

      expect(resetUserAddress(data.name)).toMatchSnapshot();
    })

  })

  describe('fetch account detail', () => {

    test('request', () => {
      let data = {
        name: 'tanuj',
        address: '76a3192ce9aa0531fe7e0e3489a469018c0bff03',
        chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9",
        flag: 'faucet'
      };
      expect(fetchAccountDetail(data.name, data.address, data.chainId, data.flag)).toMatchSnapshot();
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

  describe('fetch balance', () => {

    test('request', () => {
      let address = '76a3192ce9aa0531fe7e0e3489a469018c0bff03';
      expect(fetchBalanceRequest(address)).toMatchSnapshot();
    });

    test('success', () => {
      let detail = { balance: "3000000000000000000000" };
      expect(fetchBalanceSuccess(detail)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchBalanceFailure(error)).toMatchSnapshot();
    });

  });

  describe('fetch current account detail', () => {

    test('request', () => {
      let address = '76a3192ce9aa0531fe7e0e3489a469018c0bff03';
      expect(fetchCurrentAccountDetail(address)).toMatchSnapshot();
    });

    test('success', () => {
      let address = '76a3192ce9aa0531fe7e0e3489a469018c0bff03';
      let detail = { balance: "3000000000000000000000" };
      expect(fetchCurrentAccountDetailSuccess(address, detail)).toMatchSnapshot();
    });

    test('failure', () => {
      let address = '76a3192ce9aa0531fe7e0e3489a469018c0bff03';
      expect(fetchCurrentAccountDetailFailure(address, error)).toMatchSnapshot();
    });

  });

  describe('fetch Oauth accounts', () => {

    test('request', () => {
      expect(fetchOauthAccounts()).toMatchSnapshot();
    });

    test('success', () => {
      let data = oauthAccounts; 
      expect(fetchOauthAccountsSuccess(data)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchOauthAccountsFailure()).toMatchSnapshot();
    });

  });

});
