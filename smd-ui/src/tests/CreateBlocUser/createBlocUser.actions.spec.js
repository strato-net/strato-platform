import {
  openOverlay,
  closeOverlay,
  createBlocUser,
  createBlocUserSuccess,
  createBlocUserFailure
} from '../../components/CreateBlocUser/createBlocUser.actions';
import { formData, mockResponse, error } from './createBlocUserMock';

describe('CreateBlocUser: action', () => {

  test('open overlay', () => {
    expect(openOverlay()).toMatchSnapshot();
  });

  test('close overlay', () => {
    expect(closeOverlay()).toMatchSnapshot();
  });

  describe('create bloc user', () => {

    test('request', () => {
      expect(createBlocUser(formData.username, formData.password)).toMatchSnapshot();
    });

    test('success', () => {
      expect(createBlocUserSuccess(mockResponse)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(createBlocUserFailure(error)).toMatchSnapshot();
    });

  })

});