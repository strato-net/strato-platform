import {
  fetchBlockData,
  fetchBlockDataSuccess,
  fetchBlockDataFailure
} from "../../components/BlockData/block-data.actions";
import { blocksMock, error } from "./blockDataMock";

describe('Test blockData actions', () => {

  test('should create action to fetch block data', () => {
    expect(fetchBlockData()).toMatchSnapshot();
  });

  test('should return blocks after fetchBlockData success', () => {
    expect(fetchBlockDataSuccess(blocksMock)).toMatchSnapshot();
  });

  test('should return error after fetchBlockData failure', () => {
    expect(fetchBlockDataFailure(error)).toMatchSnapshot();
  });

});