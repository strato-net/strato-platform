import reducer from '../../components/LaunchPad/launchPad.reducer';
import { appError, appUploadError } from "./launchpadMock";
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
    const action = usernameChange();
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
