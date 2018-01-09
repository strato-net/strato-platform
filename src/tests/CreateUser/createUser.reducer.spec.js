import reducer from '../../components/CreateUser/createUser.reducer';
import {
  openOverlay,
  closeOverlay,
  createUser,
  createUserSuccess,
  createUserFailure,
} from '../../components/CreateUser/createUser.actions';
import { initialState, formData, mockResponse, error } from './createUserMock';

describe('CreateUser: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // OPEN_OVERLAY
  test('open overlay', () => {
    const action = openOverlay();
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // CLOSE_OVERLAY
  test('close overlay', () => {
    const action = closeOverlay();
    expect(reducer(initialState, action)).toMatchSnapshot();
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

  })

});