import reducer from '../../components/BlockData/block-data.reducer';
import {
  fetchBlockData, fetchBlockDataSuccess, fetchBlockDataFailure,
} from '../../components/BlockData/block-data.actions';
import { blocksMock, error } from './blockDataMock';

describe('Test applications reducer', () => {

  // INITIAL_STATE
  test('should set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // FETCH_BLOCK_DATA
  test('should fetch block data', () => {
    const action = fetchBlockData();

    const initialState = {
      blockData: [],
      error: null,
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // FETCH_BLOCK_DATA_SUCCESSFUL
  test('should fetch block data', () => {
    const action = fetchBlockDataSuccess(blocksMock);

    const initialState = {
      blockData: [],
      error: null,
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // FETCH_BLOCK_DATA_FAILED
  test('should fetch block data with error', () => {
    const action = fetchBlockDataFailure(error);

    const initialState = {
      blockData: [],
      error: null,
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  });

});
