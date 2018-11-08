import { validate } from '../../../../components/CreateChain/components/AddMember/validate';

describe('AddMember: validate', () => {

  describe('when form has', () => {

    test('values (with user)', () => {
      const data = {
        username: 'tanuj1000',
        address: 'f11b5c42f5b84efa07f6b0a32c3fc545ff509126',
        enode: 'enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@172.16.0.5:30303?discport=30303',
        balance: 100
      };
      const userSelected = true;

      expect(validate(data, userSelected)).toMatchSnapshot();
    });

    test('values (with address)', () => {
      const data = {
        username: null,
        address: 'f11b5c42f5b84efa07f6b0a32c3fc545ff509126',
        enode: 'enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7493f37f6144d86991ec012937307647bd3b9a82abe2974e1407241d54947bbb39763a4cac9f77166ad92a0@172.16.0.5:30303?discport=30303',
        balance: 100
      };
      const userSelected = true;

      expect(validate(data, userSelected)).toMatchSnapshot();
    });

    test('no values', () => {
      const data = {
        username: null,
        address: null,
        enode: null,
        balance: 100
      };
      const userSelected = true;

      expect(validate(data, userSelected)).toMatchSnapshot();
    });

  })

});