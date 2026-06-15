import { validate } from '../../../components/ExternalStorage/UploadFile/validate';
import { mockFormData } from './mockUpload';

describe('UploadFile: validate', () => {

  test('with values', () => {
    expect(validate(mockFormData)).toMatchSnapshot();
  });

  test('with empty values', () => {
    const values = {};
    expect(validate(values)).toMatchSnapshot();
  });

});