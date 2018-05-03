import reducer from '../../components/CreateBlocUser/createBlocUser.reducer';
import {
  openOverlay,
  closeOverlay,
  createBlocUser,
  createBlocUserSuccess,
  createBlocUserFailure,
} from '../../components/CreateBlocUser/createBlocUser.actions';
import { initialState, formData, mockResponse, error } from './createBlocUserMock';

describe('CreateBlocUser: reducer', () => {

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

  describe('create bloc user', () => {

    // CREATE_BLOC_USER_REQUEST
    test('on request', () => {
      const action = createBlocUser(formData.username, formData.password);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // CREATE_BLOC_USER_SUCCESS
    test('on success', () => {
      const action = createBlocUserSuccess(mockResponse);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    //CREATE_BLOC_USER_FAILURE
    test('on failure', () => {
      const action = createBlocUserFailure(error);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  })

});