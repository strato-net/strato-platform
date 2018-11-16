import { validate } from '../../components/CreateChain/validate';

describe('CreateChain: validate', () => {

  describe('when form has', () => {

    test('values', () => {
      const data = {
        chainName: 'airline',
        members: [{ address: "f11b5c42f5b84efa07f6b0a32c3fc545ff509126", enode: "enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7…4cac9f77166ad92a0@172.16.0.5:30303?discport=30303" }],
      };

      expect(validate(data)).toMatchSnapshot();
    });

    test('no values', () => {
      const data = {
        chainName: null,
        members: []
      }

      expect(validate(data)).toMatchSnapshot();
    });

  })

});