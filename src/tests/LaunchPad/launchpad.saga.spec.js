import watchAppUpload, {
  uploadApp,
  uploadAppCall
} from '../../components/LaunchPad/launchPad.saga';
import {
  takeLatest,
  call,
  put
} from 'redux-saga/effects';
import {
  APP_UPLOAD_REQUEST,
  appUploadSuccess,
  appUploadFailure
} from '../../components/LaunchPad/launchPad.actions';
import { expectSaga } from 'redux-saga-test-plan';

describe('Test launchpad saga', () => {

  test('should watch app upload', () => {
    const gen = watchAppUpload();
    expect(gen.next().value).toEqual(takeLatest(APP_UPLOAD_REQUEST, uploadApp))
  })

  describe('app upload generator', () => {
    test('inspection', () => {
      const gen = uploadApp({ type: "APP_UPLOAD_REQUEST", formData: { appUsername: 'john', appUserAddress: '', appPassword: '123456', appPackage: null } });
      expect(gen.next().value).toEqual(call(uploadAppCall, "john", "", "123456", null));
      expect(gen.next().value).toEqual(put(appUploadSuccess()));
      expect(gen.next().done).toBe(true);
    })

    test('should call upload apps with success', (done) => {
      fetch.mockResponse(JSON.stringify({}));

      expectSaga(uploadApp, { type: "APP_UPLOAD_REQUEST", formData: { appUsername: 'john', appUserAddress: '', appPassword: '123456', appPackage: '' } })
        .call.fn(uploadAppCall).put.like({ action: { type: 'APP_UPLOAD_SUCCESS' } })
        .run().then((result) => { done() });
    });

    test('should handle upload apps with failure', (done) => {
      fetch.mockReject(JSON.stringify({}));
      expectSaga(uploadApp, { type: "APP_UPLOAD_REQUEST", formData: { appUsername: 'john', appUserAddress: '', appPassword: '123456', appPackage: '' } })
        .call.fn(uploadAppCall).put.like({ action: { type: 'APP_UPLOAD_FAILURE' } })
        .run().then((result) => { done() });
    });

    test('should handle upload apps on exception', () => {
      expectSaga(uploadApp)
        .provide({
          call() {
            throw new Error('Not Found');
          },
        })
        .put.like({ action: { type: 'APP_UPLOAD_FAILURE' } })
        .run();
    });

  });

})

