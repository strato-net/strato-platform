import watchSendTokens, {
  sendTokens,
  sendTokensAPICall
} from '../../../../components/Accounts/components/SendTokens/sendTokens.saga';
import {
  takeLatest,
  call,
  put
} from 'redux-saga/effects';
import {
  SEND_TOKENS_REQUEST,
  sendTokensSuccess,
  SEND_TOKENS_SUCCESS,
  sendTokensFailure,
  SEND_TOKENS_FAILURE,
} from '../../../../components/Accounts/components/SendTokens/sendTokens.actions';
import { sendTokensResponse, error, sendTokensForm } from './sendTokensMock';
import { expectSaga } from 'redux-saga-test-plan';

describe('SendTokens: saga', () => {

  test('watch send tokens', () => {
    const gen = watchSendTokens();
    expect(gen.next().value).toEqual(takeLatest(SEND_TOKENS_REQUEST, sendTokens));
    expect(gen.next().done).toBe(true);
  });

  describe('getAccounts generator', () => {

    const action = {
      ...sendTokensForm,
      chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9",
      type: "SEND_TOKENS_REQUEST"
    };

    test('inspection', () => {
      const gen = sendTokens(action);
      expect(gen.next().value).toEqual(call(sendTokensAPICall, action.from, action.fromAddress, action.toAddress, action.value, action.password, action.chainId));
      expect(gen.next(sendTokensResponse).value).toEqual(put(sendTokensSuccess(sendTokensResponse)));
      expect(gen.throw({ message: error }).value).toEqual(put(sendTokensFailure(error)));
      expect(gen.next().done).toBe(true);
    });

    test('sendTokensAPICall with success', (done) => {
      fetch.mockResponse(JSON.stringify(sendTokensResponse));
      expectSaga(sendTokens, action)
        .call.fn(sendTokensAPICall)
        .put.like({ action: { type: SEND_TOKENS_SUCCESS } })
        .run().then((result) => { done() });
    });

    test('getAccountApi with failure', (done) => {
      fetch.mockReject(JSON.stringify(error));
      expectSaga(sendTokens, action)
        .call.fn(sendTokensAPICall)
        .put.like({ action: { type: SEND_TOKENS_FAILURE } })
        .run().then(() => { done() });
    });

  });

});