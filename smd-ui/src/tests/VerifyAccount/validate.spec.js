import { validate } from '../../components/VerifyAccount/validate';

describe('VerifyAccount: validate', () => {

  test('with values', () => {
    expect(validate({ tempPassword: 'nothing' })).toMatchSnapshot();
  });

  test('without values', () => {
    expect(validate({})).toMatchSnapshot();
  });

});