import { validate } from '../../../../components/CreateChain/components/AddIntegration/validate';

describe('AddIntegration: validate', () => {

  describe('when form has', () => {

    test('values', () => {
      const data = {
        name: 'bank',
        chainId: 'f11b5c42f5b84efa07f6b0a32c3fc545ff509126'
      };
      const userSelected = true;

      expect(validate(data, userSelected)).toMatchSnapshot();
    });

    test('no values', () => {
      const data = {
        name: null,
        chainId: null
      };
      const userSelected = true;

      expect(validate(data, userSelected)).toMatchSnapshot();
    });

  })

});