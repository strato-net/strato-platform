import { isS3Available } from '../../lib/checkS3Credentials';
import * as enviorment from "../../env";

describe('Lib: checkS3Credentials', () => {

  test('when s3 is unavailable', () => {
    enviorment.env.EXT_STORAGE_ENABLED = 'false';
    expect(isS3Available()).toMatchSnapshot();
  });

  test('when s3 is available', () => {
    enviorment.env.EXT_STORAGE_ENABLED = 'true';
    expect(isS3Available()).toMatchSnapshot();
  });
});
