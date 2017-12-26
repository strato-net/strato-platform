import {
  openOverlay,
  closeOverlay,
  createUser,
  createUserSuccess,
  createUserFailure
} from '../../components/CreateUser/createUser.actions';
import { formData, mockResponse, error } from './createUserMock';

describe('Test createUser actions', () => {

  test('should create an action to open overlay', () => {
    expect(openOverlay()).toMatchSnapshot();
  });

  test('should create an action to close overlay', () => {
    expect(closeOverlay()).toMatchSnapshot();
  });

  test('should create an action to create user', () => {
    expect(createUser(formData.username, formData.password)).toMatchSnapshot();
  });

  test('should return error after createUser response', () => {
    expect(createUserSuccess(mockResponse)).toMatchSnapshot();
  });

  test('should return error after createUser failure', () => {
    expect(createUserFailure(error)).toMatchSnapshot();
  });

});