import reducer from '../../components/CreateUser/createUser.reducer';
import {
  createUser,
  createUserSuccess,
  createUserFailure,
  resetError,
} from '../../components/CreateUser/createUser.actions';
import { initialState, formData, mockResponse, error } from './createUserMock';

describe('CreateUser: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('create user', () => {

    // CREATE_USER_REQUEST
    test('on request', () => {
      const action = createUser(formData.username, formData.password);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // CREATE_USER_SUCCESS
    test('on success', () => {
      const action = createUserSuccess(mockResponse);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    //CREATE_USER_FAILURE
    test('on failure', () => {
      const action = createUserFailure(error);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

  test('reset error', () => {
    const action = resetError('error');
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

});