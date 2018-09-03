import {
  queryCirrusVars,
  queryCirrusVarsSuccess,
  queryCirrusVarsFailure,
  clearQueryString,
  queryCirrusSuccess,
  queryCirrusFailure,
  queryCirrus,
  addQueryFilter,
  removeQueryFilter
} from '../../components/ContractQuery/contractQuery.actions';
import { error, queryCirrusVarsMock, queryCirrusMock } from './contractQueryMock';

describe('ContractQuery: action', () => {

  describe('fetch queryCirrusVars', () => {

    test('request', () => {
      expect(queryCirrusVars('Bid')).toMatchSnapshot();
    });

    test('success', () => {
      expect(queryCirrusVarsSuccess(queryCirrusVarsMock.xabi.vars)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(queryCirrusVarsFailure(error)).toMatchSnapshot();
    });

  })

  test('clear query', () => {
    expect(clearQueryString()).toMatchSnapshot();
  });

  describe('fetch queryCirrus', () => {

    test('request', () => {
      expect(queryCirrus('Bid', undefined, "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9")).toMatchSnapshot();
    });

    test('success', () => {
      expect(queryCirrusSuccess(queryCirrusMock)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(queryCirrusFailure(error)).toMatchSnapshot();
    });

  })

  test('add query filter', () => {
    const payload = {
      field: 'state',
      operator: 'eq',
      value: 1
    };
    expect(addQueryFilter(payload.field, payload.operator, payload.value)).toMatchSnapshot();
  });

  test('remove query filter', () => {
    expect(removeQueryFilter(1)).toMatchSnapshot();
  });

});