import {
  createUser,
  createUserSuccess,
  createUserFailure,
  resetError
} from '../../components/CreateUser/createUser.actions';
import { formData, mockResponse, error } from './createUserMock';

describe('CreateUser: action', () => {

  describe('create user', () => {

    test('request', () => {
      expect(createUser(formData.username, formData.password)).toMatchSnapshot();
    });

    test('success', () => {
      expect(createUserSuccess(mockResponse)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(createUserFailure(error)).toMatchSnapshot();
    });

  });

  test('reset error', () => {
    expect(resetError('error')).toMatchSnapshot();
  });

});