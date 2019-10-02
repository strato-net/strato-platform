import {
  takeEvery,
  takeLatest,
  call,
  put,
  cancelled
} from 'redux-saga/effects';
import { expectSaga } from 'redux-saga-test-plan';
import watchOauthAccountActions, {
  getOauthAccountDetail,
  faucetAccount,
  postFaucet,
  getOauthAccountDetailApi
} from '../../../../components/Accounts/components/OauthAccounts/oauthAccounts.saga';
import { oauthAccounts, error } from '../../accountsMock';
import {
  FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST,
  OAUTH_FAUCET_REQUEST,
  fetchOauthAccountDetail,
  oauthFaucetSuccess,
  oauthFaucetFailure,
  FETCH_OAUTH_ACCOUNT_DETAIL_SUCCESS,
  FETCH_OAUTH_ACCOUNT_DETAIL_FAILURE,
  OAUTH_FAUCET_SUCCESS,
  OAUTH_FAUCET_FAILURE,
  fetchOauthAccountDetailSuccess,
  fetchOauthAccountDetailFailure
} from '../../../../components/Accounts/components/OauthAccounts/oauthAccounts.actions';
import { delay } from 'redux-saga';

describe('Accounts: saga', () => {

  test('watch accounts', () => {
    const gen = watchOauthAccountActions();
    const match = [
      takeEvery(FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST, getOauthAccountDetail),
      takeEvery(OAUTH_FAUCET_REQUEST, faucetAccount),
    ]
    expect(gen.next().value).toEqual(match);
  });

  describe('faucetAccount generator', () => {

    const action = {
      type: OAUTH_FAUCET_REQUEST,
      name: oauthAccounts[0].username,
      address: oauthAccounts[0].address,
      chainId: null
    }

    test('inspection', () => {
      const gen = faucetAccount(action);
      expect(gen.next().value).toEqual(call(postFaucet, action.name, action.address));
      expect(gen.next().value).toEqual(call(delay, 100));
      expect(gen.next().value).toEqual(put(fetchOauthAccountDetail(action.name, action.address, action.chainId)));
      expect(gen.next().value).toEqual(put(oauthFaucetSuccess()));
      expect(gen.throw(error).value).toEqual(put(oauthFaucetFailure(error)));
      expect(gen.next().done).toBe(true);
    });

    test('success', (done) => {
      fetch.mockResponse(JSON.stringify(oauthAccounts[0]));
      expectSaga(faucetAccount, action.name, action.address)
        .call.fn(postFaucet)
        .put.like({ action: { type: OAUTH_FAUCET_SUCCESS } })
        .run().then((result) => { done() });
    });

    test('failure', (done) => {
      fetch.mockReject(JSON.stringify(error));
      expectSaga(faucetAccount, action.name, action.address)
        .call.fn(postFaucet)
        .put.like({ action: { type: OAUTH_FAUCET_FAILURE } })
        .run().then((result) => { done() });
    });
    
  });

  describe('getOauthAccountDetail generator', () => {

    const action = {
      type: FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST,
      name: oauthAccounts[0].username,
      address: oauthAccounts[0].address,
      chainId: null
    }

    test('inspection', () => {
      const gen = getOauthAccountDetail(action);
      expect(gen.next().value).toEqual(call(getOauthAccountDetailApi, action.address, action.chainId));
      expect(gen.next([oauthAccounts[0]]).value).toEqual(put(fetchOauthAccountDetailSuccess(oauthAccounts[0])));
      expect(gen.throw(error).value).toEqual(put(fetchOauthAccountDetailFailure(error)));
      expect(gen.next().done).toBe(true);
    });

    test('success', (done) => {
      fetch.mockResponse(JSON.stringify(oauthAccounts[0]));
      expectSaga(getOauthAccountDetail, action.address, action.chainId)
        .call.fn(getOauthAccountDetailApi)
        .put.like({ action: { type: FETCH_OAUTH_ACCOUNT_DETAIL_SUCCESS } })
        .run().then((result) => { done() });
    });

    test('failure', (done) => {
      fetch.mockReject(JSON.stringify(error));
      expectSaga(getOauthAccountDetail, action.address, action.chainId)
        .call.fn(getOauthAccountDetailApi)
        .put.like({ action: { type: FETCH_OAUTH_ACCOUNT_DETAIL_FAILURE } })
        .run().then((result) => { done() });
    });

  })


});
