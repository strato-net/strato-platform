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

describe('launchpad: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // LAUNCHPAD_LOAD
  test('load launchpad', () => {
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
  test('change user name', () => {
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

  describe('app upload', () => {

    // APP_UPLOAD_SUCCESS
    test('on success', () => {
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
    test('on failure', () => {
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

  })

  // APP_SET_ERROR
  test('set app error', () => {
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
  test('reset app ', () => {
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
