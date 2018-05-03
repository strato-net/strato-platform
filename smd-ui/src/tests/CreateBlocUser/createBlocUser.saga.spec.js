import watchCreateBlocUser, {
  createBlocUser,
  createBlocUserApiCall
} from '../../components/CreateBlocUser/createBlocUser.saga';
import {
  takeLatest,
  call,
  put
} from 'redux-saga/effects';
import {
  CREATE_BLOC_USER_REQUEST,
  createBlocUserSuccess,
  CREATE_BLOC_USER_SUCCESS,
  createBlocUserFailure,
  CREATE_BLOC_USER_FAILURE
} from '../../components/CreateBlocUser/createBlocUser.actions';
import { expectSaga } from 'redux-saga-test-plan';
import { fetchAccounts } from '../../components/Accounts/accounts.actions';
import { formData, mockResponse, error } from './createBlocUserMock';

describe('CreateBlocUser: saga', () => {

  test('watch create user', () => {
    const gen = watchCreateBlocUser();
    expect(gen.next().value).toEqual(takeLatest(CREATE_BLOC_USER_REQUEST, createBlocUser));
    expect(gen.next().done).toBe(true);
  })

  describe('createBlocUser generator', () => {

    test('inspection', () => {
      const gen = createBlocUser({ type: CREATE_BLOC_USER_REQUEST, ...formData });
      expect(gen.next().value).toEqual(call(createBlocUserApiCall, formData.username, formData.password));
      expect(gen.next(mockResponse).value).toEqual(put(createBlocUserSuccess(mockResponse)));
      expect(gen.next().value).toEqual(put(fetchAccounts(false, false)));
      expect(gen.throw(error).value).toEqual(put(createBlocUserFailure(error)));
      expect(gen.next().done).toBe(true);
    })

    describe('create bloc user', ()=> {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(mockResponse));
        expectSaga(createBlocUser, formData)
          .call.fn(createBlocUserApiCall).put.like({ action: { type: CREATE_BLOC_USER_SUCCESS } })
          .run().then((result) => { done() });
      });
  
      test('failure', (done) => {
        fetch.mockReject(JSON.stringify(error));
        expectSaga(createBlocUser, formData)
          .call.fn(createBlocUserApiCall).put.like({ action: { type: CREATE_BLOC_USER_FAILURE } })
          .run().then((result) => { done() });
      });

    })

  });

})

