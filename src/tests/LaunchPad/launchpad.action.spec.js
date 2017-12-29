import {
  appReset,
  loadLaunchPad,
  usernameChange,
  appUploadRequest,
  appUploadSuccess,
  appUploadFailure,
  appSetError
} from '../../components/LaunchPad/launchPad.actions';
import { appError, appUploadError, uploadData } from './launchpadMock';

describe('Test launchpad actions', () => {

  test('should create an action to reset app', () => {
    expect(appReset()).toMatchSnapshot();
  });

  test('should start loading app', () => {
    expect(loadLaunchPad()).toMatchSnapshot();
  });

  test('should change user name', () => {
    expect(usernameChange()).toMatchSnapshot();
  });

  test('should request to upload the app', () => {
    expect(appUploadRequest(uploadData)).toMatchSnapshot();
  });

  test('should call on app upload success', () => {
    expect(appUploadSuccess()).toMatchSnapshot();
  });

  test('should call on app upload failure', () => {
    expect(appUploadFailure(appUploadError)).toMatchSnapshot();
  });

  test('should set error on app set', () => {
    expect(appSetError(appError)).toMatchSnapshot();
  });

});