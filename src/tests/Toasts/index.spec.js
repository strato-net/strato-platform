import { toasts } from "../../components/Toasts/index";

describe('Toasts: index', () => {

  test('render component', () => {
    expect(toasts.props).toMatchSnapshot();
  });

});
