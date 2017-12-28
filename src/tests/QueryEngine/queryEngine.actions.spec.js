import {
  updateQuery, removeQuery, clearQuery, executeQueryFailure, executeQuerySuccess, executeQuery
} from '../../components/QueryEngine/queryEngine.actions';
import { error, blocksMock } from './queryEngineMock';

describe('Test queryEngine actions', () => {

  const action = {
    queryType: 'gaslim',
    queryTerm: 144,
    resourceType: '/block',
    query: { last: 15 }
  }

  it('should create an action to update query', () => {
    expect(updateQuery(action.queryType, action.queryTerm)).toMatchSnapshot();
  });

  it('should create an action to remove query', () => {
    expect(removeQuery(action.queryType)).toMatchSnapshot();
  });

  it('should create an action to execute query', () => {
    expect(executeQuery(action.resourceType, action.query)).toMatchSnapshot();
  });

  it('should create an action after execute query success', () => {
    expect(executeQuerySuccess(blocksMock)).toMatchSnapshot();
  });

  it('should create an action after execute query failure', () => {
    expect(executeQueryFailure(error)).toMatchSnapshot();
  });

  it('should create an action to clear query', () => {
    expect(clearQuery()).toMatchSnapshot();
  });

});