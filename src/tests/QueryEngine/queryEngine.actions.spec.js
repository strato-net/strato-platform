import {
  updateQuery, removeQuery, clearQuery, executeQueryFailure, executeQuerySuccess, executeQuery
} from '../../components/QueryEngine/queryEngine.actions';
import { error, blocksMock } from './queryEngineMock';

describe('QueryEngine: actions', () => {

  const action = {
    queryType: 'gaslim',
    queryTerm: 144,
    resourceType: '/block',
    query: { last: 15 }
  }

  describe('query', () => {

    test('update', () => {
      expect(updateQuery(action.queryType, action.queryTerm)).toMatchSnapshot();
    });

    test('remove', () => {
      expect(removeQuery(action.queryType)).toMatchSnapshot();
    });

    test('request', () => {
      expect(executeQuery(action.resourceType, action.query)).toMatchSnapshot();
    });

    test('success', () => {
      expect(executeQuerySuccess(blocksMock)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(executeQueryFailure(error)).toMatchSnapshot();
    });

    test('clear', () => {
      expect(clearQuery()).toMatchSnapshot();
    });

  });
});