import { toasts } from "../../components/Toasts/index";

test('should render toster props correctly', () => {
  expect(toasts.props).toMatchSnapshot();
});
