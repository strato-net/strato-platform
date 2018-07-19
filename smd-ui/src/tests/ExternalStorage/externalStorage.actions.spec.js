import {
  fetchUploadList,
  fetchUploadSuccess,
  fetchUploadFailure
} from "../../components/ExternalStorage/externalStorage.actions";
import {
  uploadList,
  error
} from "./storageMock";

describe('ExternalStorage: actions', () => {

  describe('Upload:', () => {

    test('request', () => {
      expect(fetchUploadList()).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchUploadSuccess(uploadList)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchUploadFailure(error)).toMatchSnapshot();
    });

  });

});
