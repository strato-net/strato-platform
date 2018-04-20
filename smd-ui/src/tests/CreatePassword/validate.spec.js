import { validate } from '../../components/CreatePassword/validate';

describe('CreatePassword: validate', () => {

  let createPasswordFormValues;

  beforeEach(() => {
    createPasswordFormValues = {
      password: undefined,
      confirmPassword: undefined
    };
  });

  describe('when form has', () => {

    describe('password', () => {

      test('with same value', () => {
        const data = {
          password: 'password',
          confirmPassword: 'password'
        };

        expect(validate(data)).toMatchSnapshot();
      });

      test('with diffrent value', () => {
        const data = {
          password: 'pass',
          confirmPassword: 'password'
        };

        expect(validate(data)).toMatchSnapshot();
      });

    });

    test('no values', () => {
      expect(validate(createPasswordFormValues)).toMatchSnapshot();
    });

  })

});