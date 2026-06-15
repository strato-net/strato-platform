import {
  openAttestModal, closeAttestModal, attestDocument, attestDocumentSuccess, attestDocumentFailure, changeUsername, resetError
} from "../../../components/ExternalStorage/Attest/attest.actions";
import { mockAttestFormData, error } from "./mockAttest";

describe('Attest: actions', () => {

  describe('Modal:', () => {

    test('open', () => {
      expect(openAttestModal()).toMatchSnapshot();
    })

    test('close', () => {
      expect(closeAttestModal()).toMatchSnapshot();
    })

  });

  describe('Attest:', () => {

    test('request', () => {
      expect(attestDocument(mockAttestFormData)).toMatchSnapshot();
    });

    test('success', () => {
      const result = {
        "uri": "https://strato-external-storage.s3.amazonaws.com/1530165910145-widescreen.jpeg",
        "timeStamp": 1530165910,
        "signers": [
          "6e873015e8ff27d7c6d3ab5d1403a9df9ab420ad"
        ]
      };
      expect(attestDocumentSuccess(result)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(attestDocumentFailure(error)).toMatchSnapshot();
    });

  });

  test('change username', () => {
    const username = 'tanuj1000';
    expect(changeUsername(username)).toMatchSnapshot();
  });

  test('reset error', () => {
    expect(resetError()).toMatchSnapshot();
  });

});
