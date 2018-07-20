import { isS3Available } from '../../lib/checkS3Credentials';
import * as enviorment from "../../env";

describe('Lib: checkS3Credentials', () => {

  test('when mode is public', () => {
    enviorment.env.S3_CREDENTIALS = false;
    expect(isS3Available()).toMatchSnapshot();
  });

  test('when mode is enterprise', () => {
    enviorment.env.S3_CREDENTIALS = true;
    expect(isS3Available()).toMatchSnapshot();
  });
});