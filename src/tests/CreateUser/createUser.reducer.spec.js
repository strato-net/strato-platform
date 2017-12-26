import reducer from '../../components/CreateUser/createUser.reducer';
import {
  openOverlay,
  closeOverlay,
  createUser,
  createUserSuccess,
  createUserFailure,
} from '../../components/CreateUser/createUser.actions';
import { initialState, formData, mockResponse, error } from './createUserMock';

describe('Test createUser reducer', () => {

  // INITIAL_STATE
  test('should set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // OPEN_OVERLAY
  test('should update overlay to true', () => {
    const action = openOverlay();
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // CLOSE_OVERLAY
  test('should update overlay to false', () => {
    const action = closeOverlay();
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // CREATE_USER_REQUEST
  test('should update overlay to false', () => {
    const action = createUser(formData.username, formData.password);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  //CREATE_USER_FAILURE
  test('should update overlay to false', () => {
    const action = createUserSuccess(mockResponse);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  //CREATE_USER_SUCCESS
  test('should update overlay to false', () => {
    const action = createUserFailure(error);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

});