import {
  openTokenRequestOverlay,
  closeTokenRequestOverlay
} from '../../components/TokenRequest/tokenRequest.actions';

describe('TokenRequest: actions', () => {
  test('open modal', () => {
    expect(openTokenRequestOverlay()).toMatchSnapshot();
  })

  test('close modal', () => {
    expect(closeTokenRequestOverlay()).toMatchSnapshot();
  })
});