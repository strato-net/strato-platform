import { isS3Available } from '../../lib/checkS3Credentials';
import * as enviorment from "../../env";

describe('Lib: checkS3Credentials', () => {

  test('when mode is public', () => {
    enviorment.env.EXT_STORAGE_ENABLED = 'false';
    expect(isS3Available()).toMatchSnapshot();
  });

  test('when mode is enterprise', () => {
    enviorment.env.EXT_STORAGE_ENABLED = 'true';
    expect(isS3Available()).toMatchSnapshot();
  });
});
