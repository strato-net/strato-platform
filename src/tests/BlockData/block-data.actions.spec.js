import {
  fetchBlockData,
  fetchBlockDataSuccess,
  fetchBlockDataFailure
} from "../../components/BlockData/block-data.actions";
import { blocksMock, error } from "./blockDataMock";

describe('BlockData: actions', () => {

  describe('fetchBlockData:', () => {

    test('request', () => {
      expect(fetchBlockData()).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchBlockDataSuccess(blocksMock)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchBlockDataFailure(error)).toMatchSnapshot();
    });

  });

});