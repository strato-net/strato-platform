import { required } from '../../lib/reduxFormsValidations';

describe('Form vaidation', () => {

  test('should return required when form field is empty', () => {
    expect(required(undefined)).toMatchSnapshot();
  });

  test('should return undefined when form field contain value', () => {
    expect(required('value')).toMatchSnapshot();
  });

});