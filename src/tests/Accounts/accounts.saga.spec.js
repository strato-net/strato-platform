import watchFetchContracts, {
  getAccounts,
  getUserAddresses,
  getAccountDetail,
  faucetAccount,
  getAccountsApi,
  getUserAddressesApi
} from '../../components/Accounts/accounts.saga';
import {
  takeEvery,
  takeLatest,
  call,
  put,
  cancelled
} from 'redux-saga/effects';
import {
  FETCH_ACCOUNTS,
  FETCH_ACCOUNT_ADDRESS,
  FETCH_ACCOUNT_DETAIL,
  FAUCET_REQUEST,
  fetchAccountsSuccess,
  fetchUserAddresses,
  fetchUserAddressesSuccess
} from '../../components/Accounts/accounts.actions';
import { expectSaga } from 'redux-saga-test-plan';
import { accountsMock } from './accountsMock';
import { hideLoading } from 'react-redux-loading-bar';

describe('Test accounts saga', () => {

  test('should watch accounts', () => {
    const gen = watchFetchContracts();
    const match = [
      takeLatest(FETCH_ACCOUNTS, getAccounts),
      takeEvery(FETCH_ACCOUNT_ADDRESS, getUserAddresses),
      takeEvery(FETCH_ACCOUNT_DETAIL, getAccountDetail),
      takeLatest(FAUCET_REQUEST, faucetAccount)
    ]

    expect(gen.next().value).toEqual(match);
  });

  test('should inspect getAccounts generator', () => {
    const action = {
      loadAddresses: true,
      loadBalances: true,
      type: FETCH_ACCOUNTS
    };

    const gen = getAccounts(action);
    expect(gen.next().value).toEqual(call(getAccountsApi));
    expect(gen.next(accountsMock).value).toEqual(put(fetchAccountsSuccess(accountsMock)));
    expect(gen.next().value).toEqual(accountsMock.map(account => put(fetchUserAddresses(account, action.loadBalances))));
    expect(gen.next().value).toEqual(cancelled());
    expect(gen.next(true).value).toEqual(put(hideLoading()));
    expect(gen.next().done).toBe(true);
  });

});