import reducer from "../../../components/ExternalStorage/Download/download.reducer";
import {
  openDownloadModal, closeDownloadModal, downloadSuccess, downloadFailure, resetError, clearUrl
} from "../../../components/ExternalStorage/Download/download.actions";
import { error } from "../storageMock";

describe('Download: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('Modal', () => {

    // OPEN_DOWNLOAD_MODAL
    test('open', () => {

      const initialState = {
        isOpen: false,
        error: null,
        url: null
      }

      const action = openDownloadModal();
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // CLOSE_DOWNLOAD_MODAL
    test('close', () => {

      const initialState = {
        isOpen: true,
        error: null,
        url: null
      }

      const action = closeDownloadModal();
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

  describe('create user', () => {

    const initialState = {
      isOpen: false,
      error: null,
      url: null
    }

    // DOWNLOAD_SUCCESS
    test('on success', () => {
      const url = 'https://strato-external-storage.s3.amazonaws.com/1529915329415-widescreen.jpeg';
      const action = downloadSuccess(url);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // DOWNLOAD_FAILURE
    test('on failure', () => {
      const action = downloadFailure(error);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

  // RESET_ERROR
  test('reset Error', () => {

    const initialState = {
      isOpen: false,
      error: 'error',
      url: null
    }

    const action = resetError();

    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // CLEAR_URL
  test('clear URL', () => {

    const initialState = {
      isOpen: false,
      error: 'error',
      url: null
    }

    const action = clearUrl();

    expect(reducer(initialState, action)).toMatchSnapshot();
  });

});