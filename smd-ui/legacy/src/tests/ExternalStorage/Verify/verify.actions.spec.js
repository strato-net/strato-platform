import {
  uploadList,
  error
} from "../storageMock";
import {
  openVerifyModal, closeVerifyModal, verifyDocumentRequest, verifyDocumentSuccess, verifyDocumentFailure, resetError
} from "../../../components/ExternalStorage/Verify/verify.actions";

describe('ExternalStorage: actions', () => {

  describe('Modal:', () => {

    test('open', () => {
      expect(openVerifyModal()).toMatchSnapshot();
    });

    test('close', () => {
      expect(closeVerifyModal()).toMatchSnapshot();
    });

  });

  describe('Verify:', () => {

    test('request', () => {
      const contractAddress = '23fe0e0ab7bd95fbcdff877660c595d24c6dcf5c';
      expect(verifyDocumentRequest(contractAddress)).toMatchSnapshot();
    });

    test('success', () => {
      const result = {
        "uri": "https://strato-external-storage.s3.amazonaws.com/1530182373708-widescreen.jpeg",
        "timeStamp": 1530182371,
        "signers": [
          "6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad",
          "a51f27e78aef85a06631f0725f380001e0ae9fb6"
        ]
      };
      expect(verifyDocumentSuccess(result)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(verifyDocumentFailure(error)).toMatchSnapshot();
    });

  });

  test('reset error', () => {
    expect(resetError(error)).toMatchSnapshot();
  });

});
