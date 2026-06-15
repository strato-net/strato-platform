import {
  takeLatest,
  call,
  put
} from 'redux-saga/effects';
import { expectSaga } from 'redux-saga-test-plan';
import watchUploadFile, { uploadFile, uploadFileApiCall } from '../../../components/ExternalStorage/UploadFile/uploadFile.saga';
import { UPLOAD_FILE_REQUEST, uploadFileSuccess, uploadFileFailure, UPLOAD_FILE_SUCCESS, UPLOAD_FILE_FAILURE } from '../../../components/ExternalStorage/UploadFile/uploadFile.actions';
import { mockFormData, error } from './mockUpload';
import { fetchUploadList } from '../../../components/ExternalStorage/externalStorage.actions';

describe('UploadFile: saga', () => {

  test('watch Uplaod file', () => {
    const gen = watchUploadFile();
    expect(gen.next().value).toEqual(takeLatest(UPLOAD_FILE_REQUEST, uploadFile));
    expect(gen.next().done).toBe(true);
  })

  describe('uploadFile generator', () => {

    describe('inspection', () => {

      test('Without Error', () => {
        const result = {
          contractAddress: '23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c',
          uri: 'https://strato-external-storage.s3.amazonaws.com/1529905060401-widescreen.jpeg',
          metadata: 'widescreen is one of the most important factor'
        }

        const gen = uploadFile({ type: UPLOAD_FILE_REQUEST, data: mockFormData });
        expect(gen.next().value).toEqual(call(uploadFileApiCall, mockFormData));
        expect(gen.next(result).value).toEqual(put(uploadFileSuccess(result)));
        expect(gen.next().value).toEqual(put(fetchUploadList()));
        expect(gen.throw(error).value).toEqual(put(uploadFileFailure(error)));
        expect(gen.next().done).toBe(true);
      });

      test('With Error', () => {
        const gen = uploadFile({ type: UPLOAD_FILE_REQUEST, data: mockFormData });
        expect(gen.next().value).toEqual(call(uploadFileApiCall, mockFormData));
        expect(gen.next({ error: { message: error } }).value).toEqual(put(uploadFileFailure(error)));
        expect(gen.throw(error).value).toEqual(put(uploadFileFailure(error)));
        expect(gen.next().done).toBe(true);
      });

    })

    describe('upload file', () => {
      const result = {
        contractAddress: '23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c',
        uri: 'https://strato-external-storage.s3.amazonaws.com/1529905060401-widescreen.jpeg',
        metadata: 'widescreen is one of the most important factor'
      }

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(result));
        expectSaga(uploadFile, { data: mockFormData })
          .call.fn(uploadFileApiCall).put.like({ action: { type: UPLOAD_FILE_SUCCESS } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(JSON.stringify(error));
        expectSaga(uploadFile, { data: mockFormData })
          .call.fn(uploadFileApiCall).put.like({ action: { type: UPLOAD_FILE_FAILURE } })
          .run().then((result) => { done() });
      });

    });

  });

});