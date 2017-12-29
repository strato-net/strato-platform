import reducer from '../../components/LaunchPad/launchPad.reducer';
import { appError, appUploadError, uploadData } from "./launchpadMock";
import {
  loadLaunchPad,
  appReset,
  usernameChange,
  appUploadRequest,
  appUploadSuccess,
  appUploadFailure,
  appSetError
} from '../../components/LaunchPad/launchPad.actions';
import { deepClone } from '../helper/testHelper';

describe('Test launchpad reducer', () => {

  // INITIAL_STATE
  test('should set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // LAUNCHPAD_LOAD
  test('should load launchpad', () => {
    const action = loadLaunchPad();

    const initialState = {
      firstLoad: true,
      username: '',
      error: '',
      appPackage: null,
      requestCompleted: false
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // APP_USERNAME_CHANGE
  test('should change user name', () => {
    const action = usernameChange('tanuj');
    const initialState = {
      firstLoad: true,
      username: '',
      error: '',
      appPackage: null,
      requestCompleted: false
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // APP_UPLOAD_SUCCESS
  test('should succeed to upload the app', () => {
    const action = appUploadSuccess();
    const initialState = {
      firstLoad: true,
      username: '',
      error: '',
      appPackage: null,
      requestCompleted: false
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // APP_UPLOAD_FAILURE
  test('should fail to upload the app', () => {
    const action = appUploadFailure(appUploadError);
    const initialState = {
      firstLoad: true,
      username: '',
      error: '',
      appPackage: null,
      requestCompleted: false
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // APP_SET_ERROR
  test('should set app error', () => {
    const action = appSetError(appError);
    const initialState = {
      firstLoad: true,
      username: '',
      error: '',
      appPackage: null,
      requestCompleted: false
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // APP_RESET
  test('should reset app ', () => {
    const action = appReset();
    const initialState = {
      firstLoad: true,
      username: '',
      error: '',
      appPackage: null,
      requestCompleted: false
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  })

})
