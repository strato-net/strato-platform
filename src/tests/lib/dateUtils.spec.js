import { parseDateFromString } from '../../lib/dateUtils';

describe('Lib: dateUtils', () => {

  test('parse date from string', () => {
    expect(parseDateFromString('2017-12-19 18:46:20.911451 UTC')).toMatchSnapshot();
  });

});