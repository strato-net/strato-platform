import watchSendEther, {
  sendEther, sendEtherAPICall
} from '../../../../components/Accounts/components/SendEther/sendEther.saga';
import {
  takeLatest,
  call,
  put
} from 'redux-saga/effects';
import {
  SEND_ETHER_REQUEST,
  sendEtherSuccess,
  SEND_ETHER_SUCCESS,
  sendEtherFailure,
  SEND_ETHER_FAILURE,
} from '../../../../components/Accounts/components/SendEther/sendEther.actions';
import { sendEtherResponse, error, sendEtherForm } from './sendEtherMock';
import { expectSaga } from 'redux-saga-test-plan';

describe('Test SendEther sagas', () => {

  test('should watch send ether', () => {
    const gen = watchSendEther();
    expect(gen.next().value).toEqual(takeLatest(SEND_ETHER_REQUEST, sendEther));
    expect(gen.next().done).toBe(true);
  });

  describe('getAccounts generator', () => {

    const action = {
      ...sendEtherForm,
      type: "SEND_ETHER_REQUEST"
    };

    test('inspection', () => {
      const gen = sendEther(action);

      expect(gen.next().value).toEqual(call(sendEtherAPICall, action.from, action.fromAddress, action.toAddress, action.value, action.password));
      expect(gen.next(sendEtherResponse).value).toEqual(put(sendEtherSuccess(sendEtherResponse)));
      expect(gen.throw(error).value).toEqual(put(sendEtherFailure(error)));
      expect(gen.next().done).toBe(true);
    });

    test('should call sendEtherAPICall with success', (done) => {
      fetch.mockResponse(JSON.stringify(sendEtherResponse));

      expectSaga(sendEther, action)
        .call.fn(sendEtherAPICall)
        .put.like({ action: { type: SEND_ETHER_SUCCESS } })
        .run().then((result) => { done() });
    });

    test('should call getAccountApi with failure', (done) => {
      fetch.mockReject(JSON.stringify(error));

      expectSaga(sendEther, action)
        .call.fn(sendEtherAPICall)
        .put.like({ action: { type: SEND_ETHER_FAILURE } })
        .run().then(() => { done() });
    });

  });

});