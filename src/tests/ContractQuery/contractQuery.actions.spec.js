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

describe('Test contractQuery actions', () => {

  test('should create action to query with contract name', () => {
    expect(queryCirrusVars('Bid')).toMatchSnapshot();
  });

  test('should return vars after queryCirrusVars success', () => {
    expect(queryCirrusVarsSuccess(queryCirrusVarsMock.xabi.vars)).toMatchSnapshot();
  });

  test('should return error after queryCirrusVars failure', () => {
    expect(queryCirrusVarsFailure(error)).toMatchSnapshot();
  });

  test('should create action to clear query string', () => {
    expect(clearQueryString()).toMatchSnapshot();
  });

  test('should create action for cirrus query', () => {
    expect(queryCirrus('Bid', undefined)).toMatchSnapshot();
  });

  test('should return vars after queryCirrusVars success', () => {
    expect(queryCirrusSuccess(queryCirrusMock)).toMatchSnapshot();
  });

  test('should return error after queryCirrusVars failure', () => {
    expect(queryCirrusFailure(error)).toMatchSnapshot();
  });

  test('should add query filter', () => {
    const payload = {
      field: 'state',
      operator: 'eq',
      value: 1
    };

    expect(addQueryFilter(payload.field, payload.operator, payload.value)).toMatchSnapshot();
  });

  test('should remove query filter', () => {
    expect(removeQueryFilter(1)).toMatchSnapshot();
  });

});