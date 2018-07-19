import reducer from '../../components/ExternalStorage/externalStorage.reducer';
import { initialState, uploadList, error } from './storageMock';
import { fetchUploadList, fetchUploadSuccess, fetchUploadFailure } from '../../components/ExternalStorage/externalStorage.actions';

describe('ExternalStorage: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('create user', () => {

    // FETCH_UPLOAD_LIST
    test('on request', () => {
      const action = fetchUploadList();
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // FETCH_UPLOAD_LIST_SUCCESS
    test('on success', () => {
      const action = fetchUploadSuccess(uploadList);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // FETCH_UPLOAD_LIST_FAILURE
    test('on failure', () => {
      const action = fetchUploadFailure(error);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

});