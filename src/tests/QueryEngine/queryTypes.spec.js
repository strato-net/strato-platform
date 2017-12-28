import {
  TRANSACTION_QUERY_TYPES,
  BLOCK_QUERY_TYPES,
  RESOURCE_TYPES
} from '../../components/QueryEngine/queryTypes';

describe('Query Types', () => {

  test('should have transaction query types', () => {
    expect(TRANSACTION_QUERY_TYPES).toMatchSnapshot();
  });

  test('should have block query types', () => {
    expect(BLOCK_QUERY_TYPES).toMatchSnapshot();
  });

  test('should have resource types', () => {
    expect(RESOURCE_TYPES).toMatchSnapshot();
  });

});