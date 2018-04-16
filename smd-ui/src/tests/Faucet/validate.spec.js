import { validate } from '../../components/Faucet/validate';

describe('Faucet: validate', () => {
  test('with values', () => {
    const values = {
      building: 'test'
    }

    expect(validate(values)).toMatchSnapshot();
  });

  test('with empty values', () => {
    const values = {}

    expect(validate(values)).toMatchSnapshot();
  });
});