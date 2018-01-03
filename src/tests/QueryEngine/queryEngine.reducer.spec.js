import reducer from '../../components/QueryEngine/queryEngine.reducer';
import { updateQuery, clearQuery, removeQuery, executeQueryFailure, executeQuerySuccess } from '../../components/QueryEngine/queryEngine.actions';
import { blocksMock, error } from './queryEngineMock';
import { TRANSACTION_QUERY_TYPES } from '../../components/QueryEngine/queryTypes';

describe('QueryEngine: reducer', () => {

  let payload;
  let initialState;

  beforeEach(() => {
    payload = {
      queryType: 'gaslim',
      queryTerm: 144,
      resourceType: '/block',
      query: { last: 15 }
    };

    initialState = {
      query: { last: 15 },
      queryResult: [],
      error: null,
    };
  });

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('QUERY', () => {

    // UPDATE_QUERY with default values
    test('update with default values', () => {
      const action = updateQuery(TRANSACTION_QUERY_TYPES.default.key, payload.queryTerm);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // UPDATE_QUERY
    test('update', () => {
      const action = updateQuery(payload.queryType, payload.queryTerm);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // EXECUTE_QUERY_SUCCESS
    test('success', () => {
      const action = executeQuerySuccess(blocksMock);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // EXECUTE_QUERY_FAILURE
    test('failure', () => {
      const action = executeQueryFailure(error);
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // CLEAR_QUERY
    test('clear', () => {
      const action = clearQuery();

      const initState = {
        query: {
          gaslim: 144,
          last: 15
        },
        queryResult: [],
        error: null,
      };

      expect(reducer(initState, action)).toMatchSnapshot();
    });

    // REMOVE_QUERY
    test('remove', () => {
      const action = removeQuery(payload.queryType);

      const initState = {
        query: {
          gaslim: 144,
          last: 15
        },
        queryResult: [],
        error: null,
      };

      expect(reducer(initState, action)).toMatchSnapshot();
    });

  });

});
