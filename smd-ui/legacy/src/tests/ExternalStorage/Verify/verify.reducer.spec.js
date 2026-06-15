import reducer from '../../../components/ExternalStorage/Verify/verify.reducer';
import {
  openVerifyModal, closeVerifyModal, verifyDocumentRequest, verifyDocumentSuccess, verifyDocumentFailure, resetError
} from '../../../components/ExternalStorage/Verify/verify.actions';
import {
  initialState, error
} from './verifyMock';

describe('ExternalStorage: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('Uplaod Modal', () => {

    // OPEN_VERIFY_MODAL
    test('open', () => {
      const action = openVerifyModal();
      expect(reducer(initialState, action)).toMatchSnapshot();
    })

    // CLOSE_VERIFY_MODAL
    test('close', () => {
      const action = closeVerifyModal();
      expect(reducer(initialState, action)).toMatchSnapshot();
    })

  });

  describe('create user', () => {

    // VERIFY_DOCUMENT_REQUEST
    test('on request', () => {
      const action = verifyDocumentRequest();
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // VERIFY_DOCUMENT_SUCCESS
    test('on success', () => {
      const result = {
        "uri": "https://strato-external-storage.s3.amazonaws.com/1530182373708-widescreen.jpeg",
        "timeStamp": 1530182371,
        "signers": [
          "6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad",
          "a51f27e78aef85a06631f0725f380001e0ae9fb6"
        ]
      };

      const action = verifyDocumentSuccess(result);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // VERIFY_DOCUMENT_FAILURE
    test('on failure', () => {
      const action = verifyDocumentFailure(error);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

  // RESET_ERROR
  test('on request', () => {
    const action = resetError(error);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

});