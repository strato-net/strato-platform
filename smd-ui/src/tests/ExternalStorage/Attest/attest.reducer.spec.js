import reducer from "../../../components/ExternalStorage/Attest/attest.reducer";
import { initialState } from "../storageMock";
import { openAttestModal, closeAttestModal, attestDocument, attestDocumentSuccess, attestDocumentFailure, resetError, changeUsername } from "../../../components/ExternalStorage/Attest/attest.actions";
import { mockAttestFormData, error } from "./mockAttest";

describe('UploadFile: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('attest modal', () => {

    // OPEN_ATTEST_MODAL
    test('open', () => {
      const action = openAttestModal();
      expect(reducer(initialState, action)).toMatchSnapshot();
    })

    // CLOSE_ATTEST_MODAL
    test('close', () => {
      const action = closeAttestModal();
      expect(reducer(initialState, action)).toMatchSnapshot();
    })

  });

  describe('attest file', () => {

    // ATTEST_DOCUMENT_REQUEST
    test('request', () => {
      const action = attestDocument(mockAttestFormData);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // ATTEST_DOCUMENT_SUCCESS
    test('success', () => {
      const result = {
        "uri": "https://strato-external-storage.s3.amazonaws.com/1530165910145-widescreen.jpeg",
        "timeStamp": 1530165910,
        "signers": [
          "6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad"
        ]
      };

      const action = attestDocumentSuccess(result);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // ATTEST_DOCUMENT_FAILURE
    test('failure', () => {
      const action = attestDocumentFailure(error);
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