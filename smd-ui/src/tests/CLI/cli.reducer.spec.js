import reducer from '../../components/CLI/cli.reducer';
import { openCLIOverlay, closeCLIOverlay } from '../../components/CLI/cli.actions';

describe('CLI: reducer', () => {

  // INITIAL_STATE
  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  describe('overlay', () => {

    // OPEN_OVERLAY
    test('open', () => {
      const action = openCLIOverlay();
      const initialState = {
        isTokenOpen: false
      };

      expect(reducer(initialState, action)).toMatchSnapshot();
    });

    // CLOSE_OVERLAY
    test('close', () => {
      const action = closeCLIOverlay();
      const initialState = {
        isTokenOpen: true
      };

      expect(reducer(initialState, action)).toMatchSnapshot();
    });

  });

});