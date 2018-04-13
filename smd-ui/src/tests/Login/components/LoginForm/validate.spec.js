import { validate } from '../../../../components/Login/components/LoginForm/validate';

describe('LoginForm: validate', () => {
  test('with values', () => {
    const values = {
      username: "blockapps",
      password: "password"
    }

    expect(validate(values)).toMatchSnapshot();
  });

  test('with empty values', () => {
    const values = {
      username: null,
      password: null
    }

    expect(validate(values)).toMatchSnapshot();
  });

  test('when username and password is less than minimum length', () => {
    const values = {
      username: "t",
      password: "as"
    }

    expect(validate(values)).toMatchSnapshot();
  });

  test('when username is more validation length', () => {
    const values = {
      username: `155aa553d1e3cae56f463655ccc363f29300ab89c24178c4f
      ea14f9d0171f727155aa553d1e3cae56f463655ccc363f29300ab89c24178
      c4fea14f9d0171f727155aa553d1e3cae56f463655ccc363f29300ab89c24
      178c4fea14f9d0171f727155aa553d1e3cae56f463655ccc363f29300ab89
      c24178c4fea14f9d0171f727155aa553d1e3cae56f463655ccc363f29300ab
      89c24178c4fea14f9d0171f727@gmail.com`
    }

    expect(validate(values)).toMatchSnapshot();
  });
});