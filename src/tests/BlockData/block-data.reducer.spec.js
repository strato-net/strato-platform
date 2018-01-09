import reducer from '../../components/BlockData/block-data.reducer';
import {
  fetchBlockData, fetchBlockDataSuccess, fetchBlockDataFailure,
} from '../../components/BlockData/block-data.actions';
import { blocksMock, error } from './blockDataMock';

describe('BlockData: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('FETCH_BLOCK_DATA:', () => {

    // FETCH_BLOCK_DATA
    test('on request', () => {
      const action = fetchBlockData();

      const initialState = {
        blockData: [],
        error: null,
      };

      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // FETCH_BLOCK_DATA_SUCCESSFUL
    test('on success', () => {
      const action = fetchBlockDataSuccess(blocksMock);

      const initialState = {
        blockData: [],
        error: null,
      };

      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // FETCH_BLOCK_DATA_FAILED
    test('on failure', () => {
      const action = fetchBlockDataFailure(error);

      const initialState = {
        blockData: [],
        error: null,
      };

      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

});
