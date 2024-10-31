import {
  takeEvery,
  call,
  put,
} from 'redux-saga/effects';
import { expectSaga } from 'redux-saga-test-plan';
import watchOauthAccountActions, {
  getOauthAccountDetail,
  getOauthAccountDetailApi
} from '../../../../components/Accounts/components/OauthAccounts/oauthAccounts.saga';
import { oauthAccounts, error } from '../../accountsMock';
import {
  FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST,
  FETCH_OAUTH_ACCOUNT_DETAIL_SUCCESS,
  FETCH_OAUTH_ACCOUNT_DETAIL_FAILURE,
  fetchOauthAccountDetailSuccess,
  fetchOauthAccountDetailFailure
} from '../../../../components/Accounts/components/OauthAccounts/oauthAccounts.actions';

describe('Accounts: saga', () => {

  test('watch accounts', () => {
    const gen = watchOauthAccountActions();
    const match = [
      takeEvery(FETCH_OAUTH_ACCOUNT_DETAIL_REQUEST, getOauthAccountDetail),
    ]
    expect(gen.next().value).toEqual(match);
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
