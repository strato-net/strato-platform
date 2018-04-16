import watchVerifyAccount, { verifyTempPassword, verifyTempPasswordRequest } from '../../components/VerifyAccount/verifyAccount.saga';
import {
  takeEvery,
  call,
  put
} from 'redux-saga/effects';
import { VERIFY_TEMPORARY_PASSWORD_REQUEST, verifyTempPasswordSuccess, verifyTempPasswordFailure, VERIFY_TEMPORARY_PASSWORD_SUCCESS, VERIFY_TEMPORARY_PASSWORD_FAILURE } from '../../components/VerifyAccount/verifyAccount.actions';
import { formData, mockResponse, error } from './verifyAccountMock';
import { fetchAccountDetailFailure } from '../../components/Accounts/accounts.actions';
import { expectSaga } from 'redux-saga-test-plan';

describe('VerifyAccount: saga', () => {

  test('watch verify account', () => {
    const gen = watchVerifyAccount();
    expect(gen.next().value).toEqual([takeEvery(VERIFY_TEMPORARY_PASSWORD_REQUEST, verifyTempPassword)]);
    expect(gen.next().done).toBe(true);
  })

  describe('verifyTempPassword generator', () => {

    describe('inspection', () => {
      test('Without Error', () => {
        const gen = verifyTempPassword({ type: VERIFY_TEMPORARY_PASSWORD_REQUEST, ...formData });
        expect(gen.next().value).toEqual(call(verifyTempPasswordRequest, formData.tempPassword, formData.email));
        expect(gen.next(mockResponse).value).toEqual(put(verifyTempPasswordSuccess(true)));
        expect(gen.throw(error).value).toEqual(put(verifyTempPasswordFailure(error)));
        expect(gen.next().done).toBe(true);
      });

      test('With Error', () => {
        const gen = verifyTempPassword({ type: VERIFY_TEMPORARY_PASSWORD_REQUEST, ...formData });
        expect(gen.next().value).toEqual(call(verifyTempPasswordRequest, formData.tempPassword, formData.email));
        expect(gen.next({ success: false, error: { message: 'error occured' } }).value).toEqual(put(verifyTempPasswordFailure(error)));
        expect(gen.next().done).toBe(true);
      });
    });

    describe('Verify temporary password', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(mockResponse));
        expectSaga(verifyTempPassword, formData)
          .call.fn(verifyTempPasswordRequest).put.like({ action: { type: VERIFY_TEMPORARY_PASSWORD_SUCCESS } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(JSON.stringify(error));
        expectSaga(verifyTempPassword, formData)
          .call.fn(verifyTempPasswordRequest).put.like({ action: { type: VERIFY_TEMPORARY_PASSWORD_FAILURE } })
          .run().then((result) => { done() });
      });

    });

  });

});