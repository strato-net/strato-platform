import { required } from '../../lib/reduxFormsValidations';

describe('Lib: reduxFormsValidations', () => {

  describe('returns', () => {

    test('required field', () => {
      expect(required(undefined)).toMatchSnapshot();
    });

    test('undefined', () => {
      expect(required('value')).toMatchSnapshot();
    });

  });

});