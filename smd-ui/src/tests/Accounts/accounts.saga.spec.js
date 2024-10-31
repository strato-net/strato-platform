import watchFetchContracts, {
  getAccounts,
  getUserAddresses,
  getAccountDetail,
  getAccountsApi,
  getUserAddressesApi,
  getAccountDetailApi,
  getBalance,
  getCurrentAccountDetail,
  getOauthAccounts,
  getOauthAccountsApi
} from '../../components/Accounts/accounts.saga';
import {
  takeEvery,
  takeLatest,
  call,
  put,
  cancelled
} from 'redux-saga/effects';
import {
  fetchAccountsSuccess,
  fetchUserAddresses,
  fetchUserAddressesSuccess,
  fetchAccountsFailure,
  fetchAccountDetailSuccess,
  fetchAccountDetailFailure,
  fetchAccountDetail,
  FETCH_ACCOUNTS,
  FETCH_ACCOUNT_ADDRESS,
  FETCH_ACCOUNT_DETAIL,
  FETCH_ACCOUNTS_SUCCESSFULL,
  FETCH_ACCOUNTS_FAILED,
  FETCH_USER_ADDRESSES_SUCCESSFUL,
  FETCH_USER_ADDRESSES_FAILED,
  FETCH_ACCOUNT_DETAIL_SUCCESS,
  FETCH_ACCOUNT_DETAIL_FAILURE,
  FETCH_ACCOUNT_ADDRESS_REQUEST,
  FETCH_ACCOUNT_DETAIL_REQUEST,
  GET_BALANCE,
  FETCH_CURRENT_ACCOUNT_DETAIL_REQUEST,
  fetchBalanceSuccess,
  fetchBalanceFailure,
  fetchCurrentAccountDetailSuccess,
  fetchCurrentAccountDetailFailure,
  FETCH_CURRENT_ACCOUNT_DETAIL_SUCCESS,
  FETCH_CURRENT_ACCOUNT_DETAIL_FAILURE,
  FETCH_OAUTH_ACCOUNTS_REQUEST,
  fetchOauthAccountsSuccess,
  fetchOauthAccountsFailure,
  FETCH_OAUTH_ACCOUNTS_SUCCESS,
  FETCH_OAUTH_ACCOUNTS_FAILURE
} from '../../components/Accounts/accounts.actions';
import { expectSaga } from 'redux-saga-test-plan';
import { accountsMock, userAddresses, error, accountDetail, getBalanceMock, oauthAccounts, oauthAccountsOld } from './accountsMock';
import { hideLoading } from 'react-redux-loading-bar';

describe('Accounts: saga', () => {

  test('watch accounts', () => {
    const gen = watchFetchContracts();
    const match = [
      takeLatest(FETCH_ACCOUNTS, getAccounts),
      takeEvery(FETCH_ACCOUNT_ADDRESS_REQUEST, getUserAddresses),
      takeEvery(FETCH_ACCOUNT_DETAIL_REQUEST, getAccountDetail),
      takeEvery(FETCH_CURRENT_ACCOUNT_DETAIL_REQUEST, getCurrentAccountDetail),
      takeEvery(GET_BALANCE, getBalance),
      takeEvery(FETCH_OAUTH_ACCOUNTS_REQUEST, getOauthAccounts)
    ]
    expect(gen.next().value).toEqual(match);
  });

  describe('getAccounts generator', () => {

    const action = {
      loadAddresses: true,
      loadBalances: true,
      chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9",
      type: FETCH_ACCOUNTS
    };

    describe('load address inspection', () => {

      test('true', () => {
        const gen = getAccounts(action);
        expect(gen.next().value).toEqual(call(getAccountsApi));
        expect(gen.next(accountsMock).value).toEqual(put(fetchAccountsSuccess(accountsMock)));
        expect(gen.next(true).value).toEqual(put(fetchUserAddresses(accountsMock[0], action.loadBalances, action.chainId)));
        expect(gen.throw(error).value).toEqual(put(fetchAccountsFailure(error)));
        expect(gen.next().value).toEqual(cancelled());
        expect(gen.next(true).value).toEqual(put(hideLoading()));
        expect(gen.next().done).toBe(true);
      });

      test('false', () => {
        const action = {
          loadAddresses: false,
          loadBalances: true,
          type: FETCH_ACCOUNTS
        };
        const gen = getAccounts(action);
        expect(gen.next().value).toEqual(call(getAccountsApi));
        expect(gen.next(accountsMock).value).toEqual(put(fetchAccountsSuccess(accountsMock)));
        expect(gen.next().value).toEqual({ "@@redux-saga/IO": true, "CANCELLED": {} });
        expect(gen.next().done).toBe(true);
      });

    })

    describe('getAccountApi', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(accountsMock));
        expectSaga(getAccounts, action)
          .call.fn(getAccountsApi)
          .put.like({ action: { type: FETCH_ACCOUNTS_SUCCESSFULL } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(JSON.stringify(error));
        expectSaga(getAccounts, action)
          .call.fn(getAccountsApi)
          .put.like({ action: { type: FETCH_ACCOUNTS_FAILED } })
          .run().then((result) => { done() });
      });
    })

  });


  describe('getUserAddresses generator', () => {

    const action = {
      loadBalances: true,
      name: "tanuj",
      type: FETCH_ACCOUNT_ADDRESS
    };

    test('inspection', () => {
      const gen = getUserAddresses(action);
      expect(gen.next().value).toEqual(call(getUserAddressesApi, action.name));
      expect(gen.next(userAddresses).value).toEqual(put(fetchUserAddressesSuccess(action.name, userAddresses)));
      expect(gen.next(true).value).toEqual(userAddresses.map(address => put(fetchAccountDetail(action.name, address))));
      expect(gen.next().done).toBe(true);
    });

    test('should call getUserAddressesApi with success', (done) => {
      fetch.mockResponse(JSON.stringify(userAddresses));
      expectSaga(getUserAddresses, action)
        .call.fn(getUserAddressesApi).put.like({ action: { type: FETCH_USER_ADDRESSES_SUCCESSFUL } })
        .run().then((result) => { done() });

    });

    test('should call getUserAddressesApi with failure', (done) => {
      fetch.mockReject(JSON.stringify(error));
      expectSaga(getUserAddresses, action)
        .call.fn(getUserAddressesApi).put.like({ action: { type: FETCH_USER_ADDRESSES_FAILED } })
        .run().then((result) => { done() });

    });

  });

  describe('getAccountDetail generator', () => {

    const action = {
      address: "d2263b71c14010ff03d8f786670aba691b22b158",
      name: "tanuj",
      chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9",
      type: FETCH_ACCOUNT_DETAIL
    };

    test('inspection', () => {
      const gen = getAccountDetail(action);
      expect(gen.next().value).toEqual(call(getAccountDetailApi, action.address, action.chainId));
      expect(gen.next([accountDetail]).value).toEqual(put(fetchAccountDetailSuccess(action.name, action.address, accountDetail)));
      expect(gen.throw(error).value).toEqual(put(fetchAccountDetailFailure(action.name, action.address, error)));
      expect(gen.next().done).toBe(true);
    });

    describe('getAccountDetailApi', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify([accountDetail]));
        expectSaga(getAccountDetail, action)
          .call.fn(getAccountDetailApi).put.like({ action: { type: FETCH_ACCOUNT_DETAIL_SUCCESS } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(error);
        expectSaga(getAccountDetail, action)
          .call.fn(getAccountDetailApi).put.like({ action: { type: FETCH_ACCOUNT_DETAIL_FAILURE } })
          .run().then((result) => { done() });
      });

    })

  });

  describe('getCurrentAccountDetail generator', () => {

    const action = {
      address: "d2263b71c14010ff03d8f786670aba691b22b158",
      name: "tanuj",
      type: FETCH_ACCOUNT_DETAIL
    };

    test('inspection', () => {
      const gen = getCurrentAccountDetail(action);
      expect(gen.next().value).toEqual(call(getAccountDetailApi, action.address));
      expect(gen.next([accountDetail]).value).toEqual(put(fetchCurrentAccountDetailSuccess(action.address, accountDetail)));
      expect(gen.throw(error).value).toEqual(put(fetchCurrentAccountDetailFailure(action.address, error)));
      expect(gen.next().done).toBe(true);
    });

    describe('getAccountDetailApi', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify([accountDetail]));
        expectSaga(getCurrentAccountDetail, action)
          .call.fn(getAccountDetailApi).put.like({ action: { type: FETCH_CURRENT_ACCOUNT_DETAIL_SUCCESS } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(error);
        expectSaga(getCurrentAccountDetail, action)
          .call.fn(getAccountDetailApi).put.like({ action: { type: FETCH_CURRENT_ACCOUNT_DETAIL_FAILURE } })
          .run().then((result) => { done() });
      });

    })

  });

  describe('getBalance generator', () => {

    const action = {
      address: "d2263b71c14010ff03d8f786670aba691b22b158",
      type: GET_BALANCE
    }

    test('inspection', () => {
      const gen = getBalance(action);
      expect(gen.next().value).toEqual(call(getAccountDetailApi, action.address));
      expect(gen.next(getBalanceMock).value).toEqual(put(fetchBalanceSuccess(getBalanceMock[0])));
      expect(gen.throw(error).value).toEqual(put(fetchBalanceFailure(error)));
      expect(gen.next().done).toBe(true);
    });

  });

  describe('getOauthAccounts generator', () => {

    const action = {
      type: FETCH_OAUTH_ACCOUNTS_REQUEST
    }

    test('inspection', () => {
      const gen = getOauthAccounts(action);
      expect(gen.next().value).toEqual(call(getOauthAccountsApi));
      expect(gen.next(oauthAccounts).value).toEqual(put(fetchOauthAccountsSuccess(oauthAccounts)));
      expect(gen.throw('failed to fetch oauth accounts').value).toEqual(put(fetchOauthAccountsFailure('failed to fetch oauth accounts')));
      expect(gen.next().done).toBe(true);
    });

    describe('getOauthAccountsApi', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(oauthAccounts));
        expectSaga(getOauthAccounts)
          .call.fn(getOauthAccountsApi).put.like({ action: { type: FETCH_OAUTH_ACCOUNTS_SUCCESS } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(error);
        expectSaga(getOauthAccounts)
          .call.fn(getOauthAccountsApi).put.like({ action: { type: FETCH_OAUTH_ACCOUNTS_FAILURE } })
          .run().then((result) => { done() });
      });

    })

  });

});
