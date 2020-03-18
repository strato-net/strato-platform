import { isOauthEnabled } from '../../lib/checkMode';
import * as enviorment from "../../env";

describe('Lib: checkMode', () => {

  test('is oauth enabled', () => {
    expect(isOauthEnabled()).toMatchSnapshot();
  });

  test('is oauth enabled', () => {
    enviorment.env.OAUTH_ENABLED = true;
    expect(isOauthEnabled()).toMatchSnapshot();
  });

});