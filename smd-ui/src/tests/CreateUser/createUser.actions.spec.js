import {
  openOverlay,
  closeOverlay,
  createUser,
  createUserSuccess,
  createUserFailure
} from '../../components/CreateUser/createUser.actions';
import { formData, mockResponse, error } from './createUserMock';

describe('CreateUser: action', () => {

  test('open overlay', () => {
    expect(openOverlay()).toMatchSnapshot();
  });

  test('close overlay', () => {
    expect(closeOverlay()).toMatchSnapshot();
  });

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

  })

});