import { validate } from '../../components/CreateUser/validate';

describe('CreateUser: validate', () => {

  test('with values', () => {
    const values = {
      email: "tanuj@blockapps.net"
    }
    expect(validate(values)).toMatchSnapshot();
  });

  test('with empty values', () => {
    const values = {
      email: null
    }
    expect(validate(values)).toMatchSnapshot();
  });

  test('when email has invalid format', () => {
    const values = {
      email: "tanuj"
    }
    expect(validate(values)).toMatchSnapshot();
  });

});