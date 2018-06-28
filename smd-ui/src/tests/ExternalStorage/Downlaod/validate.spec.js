import validate from '../../../components/ExternalStorage/Download/validate';

describe('Downlaod: validate', () => {

  test('with values', () => {
    const values = { contractAddress: '9c22ec56dd721cd3ca138dc1d1a05d567e019e36' };
    expect(validate(values)).toMatchSnapshot();
  });

  test('with empty values', () => {
    const values = {};
    expect(validate(values)).toMatchSnapshot();
  });

});