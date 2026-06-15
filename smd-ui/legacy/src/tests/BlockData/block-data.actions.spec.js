import {
  fetchBlockData,
  fetchBlockDataSuccess,
  fetchBlockDataFailure
} from "../../components/BlockData/block-data.actions";
import { blocksMock, error } from "./blockDataMock";

describe('BlockData: actions', () => {

  describe('fetchBlockData:', () => {
    const data = {
      chainId: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9"
    }

    test('request', () => {
      expect(fetchBlockData(data.chainId)).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchBlockDataSuccess(blocksMock)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchBlockDataFailure(error)).toMatchSnapshot();
    });

  });

});