import {
  TRANSACTION_QUERY_TYPES,
  BLOCK_QUERY_TYPES,
  RESOURCE_TYPES
} from '../../components/QueryEngine/queryTypes';

describe('QueryTypes', () => {

  test('transaction query types', () => {
    expect(TRANSACTION_QUERY_TYPES).toMatchSnapshot();
  });

  test('block query types', () => {
    expect(BLOCK_QUERY_TYPES).toMatchSnapshot();
  });

  test('resource types', () => {
    expect(RESOURCE_TYPES).toMatchSnapshot();
  });

});