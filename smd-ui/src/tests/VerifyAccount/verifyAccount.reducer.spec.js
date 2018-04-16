import reducer from '../../components/VerifyAccount/verifyAccount.reducer';
import { verifyTempPasswordFailure, verifyTempPasswordSuccess, resetError, resetTemporarypassword } from '../../components/VerifyAccount/verifyAccount.actions';
import { initialState, initialStateWithError, initialStateWithVerifiedPassword } from './verifyAccountMock';

describe('VerifyAccount: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('verify account', () => {

    // VERIFY_TEMPORARY_PASSWORD_SUCCESS
    test('on success', () => {
      const isTempPasswordVerified = true;
      const action = verifyTempPasswordSuccess(isTempPasswordVerified);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // VERIFY_TEMPORARY_PASSWORD_FAILURE
    test('on failure', () => {
      const error = 'Error to be occured';
      const action = verifyTempPasswordFailure(error);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

  test('reset error', () => {
    const action = resetError();

    expect(reducer(initialStateWithError, action)).toMatchSnapshot();
  });

  test('reset temporary password', () => {
    const action = resetTemporarypassword();

    expect(reducer(initialStateWithVerifiedPassword, action)).toMatchSnapshot();
  });

});