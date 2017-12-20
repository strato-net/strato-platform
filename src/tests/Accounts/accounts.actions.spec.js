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

describe('Test Accounts actions', () => {

  it('should create an action to fetch accounts', () => {
    const data = {
      loadAddresses: true,
      loadBalances: true
    }
    expect(fetchAccounts(data.loadAddresses, data.loadBalances)).toMatchSnapshot();
  });

  it('should return accounts after fetch account success', () => {
    expect(fetchAccountsSuccess(accountsMock)).toMatchSnapshot();
  });

  it('should return error after failure response', () => {
    expect(fetchAccountsFailure(error)).toMatchSnapshot();
  });

  it('should create an action to change account filter', () => {
    let filter = 'search accounts';
    expect(changeAccountFilter(filter)).toMatchSnapshot();
  });

  it('should create an action to fetch user addresses', () => {
    let data = {
      name: 'tanuj',
      loadBalances: true
    };
    expect(fetchUserAddresses(data.name, data.loadBalances)).toMatchSnapshot();
  });

  it('should return user address after fetch user address success', () => {
    let data = {
      name: 'tanuj',
      address: '76a3192ce9aa0531fe7e0e3489a469018c0bff03'
    };
    expect(fetchUserAddressesSuccess(data.name, data.address)).toMatchSnapshot();
  });

  it('should return error after fetch user address failure', () => {
    let data = {
      name: 'tanuj',
      error
    };
    expect(fetchUserAddressesFailure(data.name, data.error)).toMatchSnapshot();
  });

  it('should create an action to fetch account detail', () => {
    let data = {
      name: 'tanuj',
      address: '76a3192ce9aa0531fe7e0e3489a469018c0bff03'
    };
    expect(fetchAccountDetail(data.name, data.address)).toMatchSnapshot();
  });

  it('should return account detail after fetch account detail success', () => {
    let data = {
      name: 'tanuj',
      address: '76a3192ce9aa0531fe7e0e3489a469018c0bff03',
      detail: accountDetail
    };
    expect(fetchAccountDetailSuccess(data.name, data.address, data.detail)).toMatchSnapshot();
  });

  it('should return error after fetch account detail failure', () => {
    let data = {
      name: 'tanuj',
      address: '76a3192ce9aa0531fe7e0e3489a469018c0bff03',
      error
    };
    expect(fetchAccountDetailFailure(data.name, data.address, data.error)).toMatchSnapshot();
  });

  it('should create an action to faucet request', () => {
    let data = {
      name: 'tanuj',
      address: '76a3192ce9aa0531fe7e0e3489a469018c0bff03'
    };
    expect(faucetRequest(data.name, data.address)).toMatchSnapshot();
  });

  it('should returns with success on faucet request', () => {
    expect(faucetSuccess()).toMatchSnapshot();
  });

  it('should return error after faucet request failure', () => {
    expect(faucetFailure(error)).toMatchSnapshot();
  });

});