import constants from "../../lib/constants";

describe('Lib: constants', () => {

  test('have proper structure', () => {
    expect(constants).toMatchSnapshot();
  });

});