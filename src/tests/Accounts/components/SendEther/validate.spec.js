import { validate } from '../../../../components/Accounts/components/SendEther/validate';
import { sendEtherForm } from './sendEtherMock';

describe('SendEther validate function: ', () => {

  const sendEtherFormValidate = {
    from: undefined,
    fromAddress: undefined,
    password: undefined,
    toAddress: undefined,
    value: undefined
  };

  test('when form has values', () => {
    expect(validate(sendEtherForm)).toMatchSnapshot();
  });

  test('when form has no values', () => {
    expect(validate(sendEtherFormValidate)).toMatchSnapshot();
  });

  describe('radio button:', () => {

    test('when user radio is selected (means 0th index)', () => {
      const values = {
        ...sendEtherFormValidate,
        radio: "0"
      };

      expect(validate(values)).toMatchSnapshot();
    });

    test('when address radio is selected (means 1st index)', () => {
      const values = {
        ...sendEtherFormValidate,
        radio: "1"
      };

      expect(validate(values)).toMatchSnapshot();
    });

  });

});