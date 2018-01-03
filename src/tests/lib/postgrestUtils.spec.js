import { gernerateSubQuery, generateQueryString } from '../../lib/postgrestUtils';

describe('Lib: postgrestUtils', () => {

  describe('Query String:', () => {
    const payload = [{
      field: 'state',
      operator: 'eq',
      value: 1,
      display: "state eq a"
    }];

    test('generate query string', () => {
      expect(generateQueryString(payload)).toMatchSnapshot();
    });

    test('generate sub query', () => {
      expect(gernerateSubQuery(payload[0].field, payload[0].operator, payload[0].value)).toMatchSnapshot();
      expect(gernerateSubQuery(payload[0].field, 'like', payload[0].value)).toMatchSnapshot();
      expect(gernerateSubQuery(payload[0].field, 'ilike', payload[0].value)).toMatchSnapshot();
    });

    test('generate multiple query string', () => {
      const data = [
        {
          field: "amount",
          operator: "like",
          value: "5678",
          display: "amount eq 5678"
        },
        ...payload
      ];

      expect(generateQueryString(data)).toMatchSnapshot();
    });
  });

});