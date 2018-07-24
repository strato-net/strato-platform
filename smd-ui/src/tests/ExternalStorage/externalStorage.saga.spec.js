import {
  takeLatest,
  call,
  put
} from 'redux-saga/effects';
import { expectSaga } from 'redux-saga-test-plan';

import watchFetchUpload, { fetchUpload, attestDocument, verifyUpload, download, fetchUploadListApiCall, attestDocumentApiCall, verifyDocumentApiCall, downloadApiCall } from "../../components/ExternalStorage/externalStorage.saga";
import { FETCH_UPLOAD_LIST, fetchUploadList, fetchUploadSuccess, fetchUploadFailure, FETCH_UPLOAD_LIST_SUCCESS, FETCH_UPLOAD_LIST_FAILURE } from "../../components/ExternalStorage/externalStorage.actions";
import { ATTEST_DOCUMENT_REQUEST, attestDocumentSuccess, attestDocumentFailure, ATTEST_DOCUMENT_SUCCESS, ATTEST_DOCUMENT_FAILURE } from "../../components/ExternalStorage/Attest/attest.actions";
import { VERIFY_DOCUMENT_REQUEST, verifyDocumentSuccess, verifyDocumentFailure, VERIFY_DOCUMENT_SUCCESS, VERIFY_DOCUMENT_FAILURE } from "../../components/ExternalStorage/Verify/verify.actions";
import { DOWNLOAD_REQUEST, downloadSuccess, downloadFailure, DOWNLOAD_FAILURE, DOWNLOAD_SUCCESS } from "../../components/ExternalStorage/Download/download.actions";
import { uploadList, error, attestDocumentMock, verifyMock } from './storageMock';


describe('ExternalStorage: saga', () => {

  test('watch fetch Uplaod', () => {
    const gen = watchFetchUpload();
    expect(gen.next().value).toEqual(takeLatest(FETCH_UPLOAD_LIST, fetchUpload));
    expect(gen.next().value).toEqual(takeLatest(ATTEST_DOCUMENT_REQUEST, attestDocument));
    expect(gen.next().value).toEqual(takeLatest(VERIFY_DOCUMENT_REQUEST, verifyUpload));
    expect(gen.next().value).toEqual(takeLatest(DOWNLOAD_REQUEST, download));
    expect(gen.next().done).toBe(true);
  })

  describe('fetchUpload generator', () => {

    describe('inspection', () => {
      test('Without Error', () => {
        const gen = fetchUpload({ type: FETCH_UPLOAD_LIST });
        expect(gen.next().value).toEqual(call(fetchUploadListApiCall));
        expect(gen.next({ list: uploadList }).value).toEqual(put(fetchUploadSuccess(uploadList)));
        expect(gen.next().done).toBe(true);
      });

      test('With Error', () => {
        const gen = fetchUpload({ type: FETCH_UPLOAD_LIST });
        expect(gen.next().value).toEqual(call(fetchUploadListApiCall));
        expect(gen.throw(error).value).toEqual(put(fetchUploadFailure(error)));
        expect(gen.next().done).toBe(true);
      });
    })

    describe('upload list', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify({ list: uploadList }));
        expectSaga(fetchUpload)
          .call.fn(fetchUploadListApiCall).put.like({ action: { type: FETCH_UPLOAD_LIST_SUCCESS } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(JSON.stringify(error));
        expectSaga(fetchUpload)
          .call.fn(fetchUploadListApiCall).put.like({ action: { type: FETCH_UPLOAD_LIST_FAILURE } })
          .run().then((result) => { done() });
      });

    });

  });

  describe('attestDocument generator', () => {

    describe('inspection', () => {

      const values = {
        username: 'tanuj55@mailinator.com',
        address: '23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c',
        password: 'password',
        contractAddress: 'c918420c68346af5fe2aef067faf7b103afde5ed'
      }

      test('Without Error', () => {
        const gen = attestDocument({ type: ATTEST_DOCUMENT_REQUEST, values: values });
        expect(gen.next().value).toEqual(call(attestDocumentApiCall, values));
        expect(gen.next(values).value).toEqual(put(attestDocumentSuccess(values)));
        expect(gen.throw(error).value).toEqual(put(attestDocumentFailure(error)));
        expect(gen.next().done).toBe(true);
      });

      test('With Error', () => {
        const gen = attestDocument({ type: ATTEST_DOCUMENT_REQUEST, values: values });
        expect(gen.next().value).toEqual(call(attestDocumentApiCall, values));
        expect(gen.next({ error: { message: error } }).value).toEqual(put(attestDocumentFailure(error)));
        expect(gen.next().done).toBe(true);
      });
    })

    describe('attest document api', () => {

      const values = {
        username: 'tanuj55@mailinator.com',
        address: '23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c',
        password: 'password',
        contractAddress: 'c918420c68346af5fe2aef067faf7b103afde5ed'
      }

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify({ attestDocumentMock }));
        expectSaga(attestDocument, values)
          .call.fn(attestDocumentApiCall).put.like({ action: { type: ATTEST_DOCUMENT_SUCCESS } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(JSON.stringify(error));
        expectSaga(attestDocument, values)
          .call.fn(attestDocumentApiCall).put.like({ action: { type: ATTEST_DOCUMENT_FAILURE } })
          .run().then((result) => { done() });
      });

    });

  });

  describe('verifyUpload generator', () => {

    const values = {
      contractAddress: 'c918420c68346af5fe2aef067faf7b103afde5ed'
    }

    describe('inspection', () => {

      test('Without Error', () => {
        const gen = verifyUpload({ type: VERIFY_DOCUMENT_REQUEST, contractAddress: values.contractAddress });
        expect(gen.next().value).toEqual(call(verifyDocumentApiCall, values.contractAddress));
        expect(gen.next(values).value).toEqual(put(verifyDocumentSuccess(values)));
        expect(gen.throw(error).value).toEqual(put(verifyDocumentFailure(error)));
        expect(gen.next().done).toBe(true);
      });

      test('With Error', () => {
        const gen = verifyUpload({ type: VERIFY_DOCUMENT_REQUEST, contractAddress: values.contractAddress });
        expect(gen.next().value).toEqual(call(verifyDocumentApiCall, values.contractAddress));
        expect(gen.next({ error: { message: error } }).value).toEqual(put(verifyDocumentFailure(error)));
        expect(gen.next().done).toBe(true);
      });

    })

    describe('verify uplaod', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify({ verifyMock }));
        expectSaga(verifyUpload, values.contractAddress)
          .call.fn(verifyDocumentApiCall).put.like({ action: { type: VERIFY_DOCUMENT_SUCCESS } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(JSON.stringify(error));
        expectSaga(verifyUpload, values.contractAddress)
          .call.fn(verifyDocumentApiCall).put.like({ action: { type: VERIFY_DOCUMENT_FAILURE } })
          .run().then((result) => { done() });
      });

    });

  });

  describe('download generator', () => {

    const values = {
      contractAddress: 'c918420c68346af5fe2aef067faf7b103afde5ed'
    }

    const response = {
      url: 'https://strato-external-storage.s3.amazonaws.com/1529905060401-widescreen.jpeg'
    }

    describe('inspection', () => {

      test('Without Error', () => {
        const gen = download({ type: DOWNLOAD_REQUEST, contractAddress: values.contractAddress });
        expect(gen.next().value).toEqual(call(downloadApiCall, values.contractAddress));
        expect(gen.next(response).value).toEqual(put(downloadSuccess(response.url)));
        expect(gen.throw(error).value).toEqual(put(downloadFailure(error)));
        expect(gen.next().done).toBe(true);
      });

      test('With Error', () => {
        const gen = download({ type: DOWNLOAD_REQUEST, contractAddress: values.contractAddress });
        expect(gen.next().value).toEqual(call(downloadApiCall, values.contractAddress));
        expect(gen.next({ error: { message: error } }).value).toEqual(put(downloadFailure(error)));
        expect(gen.next().done).toBe(true);
      });

    })

    describe('download', () => {

      test('success', (done) => {
        fetch.mockResponse(JSON.stringify(response));
        expectSaga(download, values.contractAddress)
          .call.fn(downloadApiCall).put.like({ action: { type: DOWNLOAD_SUCCESS } })
          .run().then((result) => { done() });
      });

      test('failure', (done) => {
        fetch.mockReject(JSON.stringify(error));
        expectSaga(download, values.contractAddress)
          .call.fn(downloadApiCall).put.like({ action: { type: DOWNLOAD_FAILURE } })
          .run().then((result) => { done() });
      });

    });

  });

})