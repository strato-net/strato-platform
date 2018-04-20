import { isModePublic } from '../../lib/checkMode';
import * as enviorment from "../../env";

describe('Lib: checkMode', () => {

  test('when mode is public', () => {
    enviorment.env.SMD_MODE = 'public';
    expect(isModePublic()).toMatchSnapshot();
  });

  test('when mode is enterprise', () => {
    enviorment.env.SMD_MODE = 'enterprise';
    expect(isModePublic()).toMatchSnapshot();
  });
});