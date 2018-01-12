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

describe('launchpad: action', () => {

  test('reset app', () => {
    expect(appReset()).toMatchSnapshot();
  });

  test('start loading app', () => {
    expect(loadLaunchPad()).toMatchSnapshot();
  });

  test('change user name', () => {
    expect(usernameChange()).toMatchSnapshot();
  });

  describe('upload app', () => {

    test('request', () => {
      expect(appUploadRequest(uploadData)).toMatchSnapshot();
    });

    test('success', () => {
      expect(appUploadSuccess()).toMatchSnapshot();
    });

    test('failure', () => {
      expect(appUploadFailure(appUploadError)).toMatchSnapshot();
    });

  })

  test('set error on app set', () => {
    expect(appSetError(appError)).toMatchSnapshot();
  });

});