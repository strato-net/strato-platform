import { validate } from '../../../../components/Accounts/components/SendTokens/validate';
import { sendTokensForm } from './sendTokensMock';

describe('SendTokens: validate', () => {

  let sendTokensFormValidate

  beforeEach(() => {
    sendTokensFormValidate = {
      from: undefined,
      fromAddress: undefined,
      password: undefined,
      toAddress: undefined,
      value: undefined
    };
  });

  describe('when form has', () => {

    test('values', () => {
      expect(validate(sendTokensForm)).toMatchSnapshot();
    });

    test('no values', () => {
      expect(validate(sendTokensFormValidate)).toMatchSnapshot();
    });

  })

  describe('radio button:', () => {

    test('user is selected (0th index)', () => {
      const values = {
        ...sendTokensFormValidate,
        radio: "0"
      };
      expect(validate(values)).toMatchSnapshot();
    });

    test('address is selected (1st index)', () => {
      const values = {
        ...sendTokensFormValidate,
        radio: "1"
      };
      expect(validate(values)).toMatchSnapshot();
    });

  });

});