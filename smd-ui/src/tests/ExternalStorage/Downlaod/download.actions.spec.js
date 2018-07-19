import {
  openDownloadModal,
  closeDownloadModal,
  downloadRequest,
  downloadSuccess,
  downloadFailure,
  resetError,
  clearUrl
} from "../../../components/ExternalStorage/Download/download.actions";
import { error } from "../storageMock";

describe('Download: actions', () => {

  describe('Modal:', () => {

    test('open', () => {
      expect(openDownloadModal()).toMatchSnapshot();
    });

    test('close', () => {
      expect(closeDownloadModal()).toMatchSnapshot();
    });

  });

  describe('Downlaod:', () => {

    test('request', () => {
      const contractAddress = 'c918420c68346af5fe2aef067faf7b103afde5ed';
      expect(downloadRequest(contractAddress)).toMatchSnapshot();
    });

    test('success', () => {
      const url = 'https://strato-external-storage.s3.amazonaws.com/1529915329415-widescreen.jpeg';
      expect(downloadSuccess(url)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(downloadFailure(error)).toMatchSnapshot();
    });

  });

  test('reset error', () => {
    expect(resetError()).toMatchSnapshot();
  });

  test('clear Url', () => {
    expect(clearUrl()).toMatchSnapshot();
  });

});
