import reducer from '../../components/ContractQuery/contractQuery.reducer';
import { clearQueryString, queryCirrusSuccess, queryCirrusFailure, queryCirrusVarsSuccess, addQueryFilter, removeQueryFilter } from '../../components/ContractQuery/contractQuery.actions';
import { queryCirrusMock, error, queryCirrusVarsMock } from './contractQueryMock';

describe('ContractQuery: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // CLEAR_QUERY_STRING
  test('clear query', () => {
    const action = clearQueryString();
    const initialState = {
      queryString: 'state=eq.1',
      queryResults: null,
      tags: [],
      vars: null,
      error: null
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  describe('fetch querycirrus', () => {
    // QUERY_CIRRUS_SUCCESS
    test('success', () => {
      const action = queryCirrusSuccess(queryCirrusMock);
      const initialState = {
        queryString: '',
        queryResults: null,
        tags: [],
        vars: null,
        error: null
      }
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // QUERY_CIRRUS_FAILURE
    test('failure', () => {
      const action = queryCirrusFailure(error);
      const initialState = {
        queryString: '',
        queryResults: null,
        tags: [],
        vars: null,
        error: null
      }
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  })

  // QUERY_CIRRUS_VARS_SUCCESS
  test('queryCirrusVars success', () => {
    const action = queryCirrusVarsSuccess(queryCirrusVarsMock.xabi.vars);
    const initialState = {
      queryString: '',
      queryResults: queryCirrusMock,
      tags: [],
      vars: null,
      error: null
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // ADD_QUERY_FILTER
  test('add new filter', () => {
    const payload = {
      field: 'state',
      operator: 'eq',
      value: 1
    };
    const action = addQueryFilter(payload.field, payload.operator, payload.value);
    const initialState = {
      queryString: '',
      queryResults: queryCirrusMock,
      tags: [],
      vars: queryCirrusVarsMock.xabi.vars,
      error: null
    }
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  // REMOVE_QUERY_FILTER with it's cases
  describe('remove query filter', () => {

    test('that contains only one tag', () => {
      const action = removeQueryFilter(0);
      const initialState = {
        queryString: 'state=eq.1',
        queryResults: queryCirrusMock,
        tags: [{
          display: "state eq 1",
          field: "state",
          operator: "eq",
          value: 1,
        }],
        vars: queryCirrusVarsMock.xabi.vars,
        error: null
      }
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    test('that contains two tags', () => {
      const action = removeQueryFilter(0);
      const initialState = {
        queryString: 'state=eq.1&amount=eq.5678',
        queryResults: queryCirrusMock,
        tags: [
          {
            field: "state",
            operator: "eq",
            value: "1",
            display: "state eq 1"
          },
          {
            field: "amount",
            operator: "eq",
            value: "5678",
            display: "amount eq 5678"
          }
        ],
        vars: queryCirrusVarsMock.xabi.vars,
        error: null
      }
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    test('center tags from multiple tags', () => {
      const action = removeQueryFilter(1);
      const initialState = {
        queryString: 'state=eq.1&amount=eq.5678&name=eq.P',
        queryResults: queryCirrusMock,
        tags: [
          {
            field: "state",
            operator: "eq",
            value: "1",
            display: "state eq 1"
          },
          {
            field: "amount",
            operator: "eq",
            value: "5678",
            display: "amount eq 5678"
          },
          {
            display: "name eq P",
            field: "name",
            operator: "eq",
            value: "P"
          }
        ],
        vars: queryCirrusVarsMock.xabi.vars,
        error: null
      }
      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

});
