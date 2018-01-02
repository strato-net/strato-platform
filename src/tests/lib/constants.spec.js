import constants from "../../lib/constants";

test('should renders correctly', () => {
  expect(constants).toMatchSnapshot();
});
