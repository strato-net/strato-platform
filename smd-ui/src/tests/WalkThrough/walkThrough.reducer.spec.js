import reducer from '../../components/WalkThrough/walkThrough.reducer';
import {
  openWalkThroughOverlay,
  closeWalkThroughOverlay
} from '../../components/WalkThrough/walkThrough.actions';

describe('WalkThrough: reducer', () => {
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  test('open modal', () => {
    const action = openWalkThroughOverlay(true);
    const initialState = {
      isWalkThroughOpen: false,
      isLoggedIn: false
    };
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('close modal', () => {
    const action = closeWalkThroughOverlay();
    const initialState = {
      isWalkThroughOpen: false,
      isLoggedIn: false
    };
    expect(reducer(initialState, action)).toMatchSnapshot();
  });
})
