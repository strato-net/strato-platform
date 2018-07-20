import validate from '../../../components/ExternalStorage/Attest/validate';
import { mockAttestFormData } from './mockAttest';

describe('Attest: validate', () => {

  test('with values', () => {
    expect(validate(mockAttestFormData)).toMatchSnapshot();
  });

  test('with empty values', () => {
    const values = {};
    expect(validate(values)).toMatchSnapshot();
  });

});