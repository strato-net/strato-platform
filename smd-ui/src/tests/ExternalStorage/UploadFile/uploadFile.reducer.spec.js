import reducer from '../../../components/ExternalStorage/UploadFile/uploadFile.reducer';
import {
  openUploadModal,
  closeUploadModal,
  uploadFileRequest,
  uploadFileSuccess,
  uploadFileFailure,
  resetError,
  changeUsername
} from '../../../components/ExternalStorage/UploadFile/uploadFile.actions';
import { initialState, mockFormData, error } from './mockUpload';


describe('UploadFile: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('Uplaod Modal', () => {

    // OPEN_UPLOAD_MODAL
    test('open', () => {
      const action = openUploadModal();
      expect(reducer(initialState, action)).toMatchSnapshot();
    })

    // CLOSE_UPLOAD_MODAL
    test('close', () => {
      const action = closeUploadModal();
      expect(reducer(initialState, action)).toMatchSnapshot();
    })

  });

  describe('Uplaod File', () => {

    // UPLOAD_FILE_REQUEST
    test('on request', () => {
      const action = uploadFileRequest(mockFormData);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // UPLOAD_FILE_SUCCESS
    test('on success', () => {
      let result = {
        contractAddress: '23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c',
        uri: 'https://strato-external-storage.s3.amazonaws.com/1529905060401-widescreen.jpeg',
        metadata: 'widescreen is one of the most important factor'
      }

      const action = uploadFileSuccess(result);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // UPLOAD_FILE_FAILURE
    test('on failure', () => {
      const action = uploadFileFailure(error);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

  // RESET_ERROR
  test('reset error', () => {
    const init = {
      ...initialState,
      error: error
    }
    const action = resetError();
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // USERNAME_FORM_CHANGE
  test('change username', () => {
    const init = {
      ...initialState,
      username: 'tanuj55'
    }

    const action = changeUsername();
    expect(reducer(initialState, action)).toMatchSnapshot();
  });


});