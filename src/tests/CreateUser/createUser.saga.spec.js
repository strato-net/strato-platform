import watchFetchContracts, {
  createUser,
  createUserApiCall
} from '../../components/CreateUser/createUser.saga';
import {
  takeLatest,
  call,
  put
} from 'redux-saga/effects';
import {
  CREATE_USER_REQUEST,
  createUserSuccess,
  CREATE_USER_SUCCESS,
  createUserFailure,
  CREATE_USER_FAILURE,
} from '../../components/CreateUser/createUser.actions';
import { expectSaga } from 'redux-saga-test-plan';
import { fetchAccounts } from '../../components/Accounts/accounts.actions';
import { formData, mockResponse, error } from './createUserMock';

describe('CreateUser: saga', () => {

  test('watch create user', () => {
    const gen = watchFetchContracts();
    expect(gen.next().value).toEqual(takeLatest(CREATE_USER_REQUEST, createUser));
    expect(gen.next().done).toBe(true);
  })

  describe('createUser generator', () => {

    test('inspection', () => {
      const gen = createUser({ type: CREATE_USER_REQUEST, ...formData });
      expect(gen.next().value).toEqual(call(createUserApiCall, formData.username, formData.password));
      expect(gen.next(mockResponse).value).toEqual(put(createUserSuccess(mockResponse)));
      expect(gen.next().value).toEqual(put(fetchAccounts(true, true)));
      expect(gen.throw(error).value).toEqual(put(createUserFailure(error)));
      expect(gen.next().done).toBe(true);
    })

    describe('create user', ()=> {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(mockResponse));
        expectSaga(createUser, formData)
          .call.fn(createUserApiCall).put.like({ action: { type: CREATE_USER_SUCCESS } })
          .run().then((result) => { done() });
      });
  
      test('failure', (done) => {
        fetch.mockReject(JSON.stringify(error));
        expectSaga(createUser, formData)
          .call.fn(createUserApiCall).put.like({ action: { type: CREATE_USER_FAILURE } })
          .run().then((result) => { done() });
      });

    })

  });

})

