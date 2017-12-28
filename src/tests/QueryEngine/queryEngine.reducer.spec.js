import reducer from '../../components/QueryEngine/queryEngine.reducer';
import { updateQuery, clearQuery, removeQuery, executeQueryFailure, executeQuerySuccess } from '../../components/QueryEngine/queryEngine.actions';
import { blocksMock, error } from './queryEngineMock';

describe('Test queryEngine reducer', () => {

  const payload = {
    queryType: 'gaslim',
    queryTerm: 144,
    resourceType: '/block',
    query: { last: 15 }
  };

  const initialState = {
    query: { last: 15 },
    queryResult: [],
    error: null,
  };

  // INITIAL_STATE
  test('should set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // UPDATE_QUERY
  test('should update query store', () => {
    const action = updateQuery(payload.queryType, payload.queryTerm);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // EXECUTE_QUERY_SUCCESS
  test('should update query after execute query success', () => {
    const action = executeQuerySuccess(blocksMock);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // EXECUTE_QUERY_FAILURE
  test('should update query after execute query success', () => {
    const action = executeQueryFailure(error);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // CLEAR_QUERY
  test('should clear query', () => {
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
  test('should remove query', () => {
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
