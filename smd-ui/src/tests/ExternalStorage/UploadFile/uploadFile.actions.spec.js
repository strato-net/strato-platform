import { openUploadModal, closeUploadModal, uploadFileRequest, uploadFileSuccess, uploadFileFailure, resetError, changeUsername } from '../../../components/ExternalStorage/UploadFile/uploadFile.actions';
import { mockFormData, error } from './mockUpload';

describe('UploadFile: actions', () => {

  describe('Modal:', () => {

    test('open', () => {
      expect(openUploadModal()).toMatchSnapshot();
    });

    test('close', () => {
      expect(closeUploadModal()).toMatchSnapshot();
    });

  });

  describe('Upload:', () => {

    test('request', () => {
      expect(uploadFileRequest(mockFormData)).toMatchSnapshot();
    });

    test('success', () => {
      let result = {
        contractAddress: '23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c',
        uri: 'https://strato-external-storage.s3.amazonaws.com/1529905060401-widescreen.jpeg',
        metadata: 'widescreen is one of the most important factor'
      }

      expect(uploadFileSuccess(result)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(uploadFileFailure(error)).toMatchSnapshot();
    });

  });

  test('Reset errors', () => {
    expect(resetError()).toMatchSnapshot();
  });

  test('change username', () => {
    expect(changeUsername('tanuj55')).toMatchSnapshot();
  });

});