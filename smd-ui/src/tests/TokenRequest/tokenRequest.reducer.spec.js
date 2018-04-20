import reducer from '../../components/TokenRequest/tokenRequest.reducer';
import {
  openTokenRequestOverlay,
  closeTokenRequestOverlay
} from '../../components/TokenRequest/tokenRequest.actions';

describe('TokenRequest: reducer', () => {
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  test('open modal', () => {
    const action = openTokenRequestOverlay();
    const initialState = {
      isTokenOpen: false
    };
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('close modal', () => {
    const action = closeTokenRequestOverlay();
    const initialState = {
      isTokenOpen: false
    };
    expect(reducer(initialState, action)).toMatchSnapshot();
  });
})
