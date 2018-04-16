import {
  verifyTempPassword,
  verifyTempPasswordSuccess,
  verifyTempPasswordFailure,
  resetError,
  resetTemporarypassword
} from '../../components/VerifyAccount/verifyAccount.actions';

describe('VerifyAccount: actions', () => {

  describe('Verify temporary password', () => {

    test('request', () => {
      const data = { tempPassword: 'password' }

      expect(verifyTempPassword(data, 'no-reply@blockapps.net')).toMatchSnapshot();
    });

    test('success', () => {
      const isTempPasswordVerified = true;
      expect(verifyTempPasswordSuccess(isTempPasswordVerified)).toMatchSnapshot();
    });

    test('failure', () => {
      const error = 'Error to be occured';
      expect(verifyTempPasswordFailure(error)).toMatchSnapshot();
    });

  });

  test('reset error', () => {
    expect(resetError()).toMatchSnapshot();
  });

  test('reset temporary password', () => {
    expect(resetTemporarypassword()).toMatchSnapshot();
  });

});