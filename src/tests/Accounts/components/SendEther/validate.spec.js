import { validate } from '../../../../components/Accounts/components/SendEther/validate';
import { sendEtherForm } from './sendEtherMock';

describe('SendEther: validate', () => {

  let sendEtherFormValidate

  beforeEach(() => {
    sendEtherFormValidate = {
      from: undefined,
      fromAddress: undefined,
      password: undefined,
      toAddress: undefined,
      value: undefined
    };
  });

  describe('when form has', () => {

    test('values', () => {
      expect(validate(sendEtherForm)).toMatchSnapshot();
    });

    test('no values', () => {
      expect(validate(sendEtherFormValidate)).toMatchSnapshot();
    });

  })

  describe('radio button:', () => {

    test('user is selected (0th index)', () => {
      const values = {
        ...sendEtherFormValidate,
        radio: "0"
      };
      expect(validate(values)).toMatchSnapshot();
    });

    test('address is selected (1st index)', () => {
      const values = {
        ...sendEtherFormValidate,
        radio: "1"
      };
      expect(validate(values)).toMatchSnapshot();
    });

  });

});