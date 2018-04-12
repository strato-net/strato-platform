import { openCLIOverlay, closeCLIOverlay } from '../../components/CLI/cli.actions';

describe('CLI: actions', () => {

  test('open overlay', () => {
    expect(openCLIOverlay()).toMatchSnapshot();
  });

  test('close overlay', () => {
    expect(closeCLIOverlay()).toMatchSnapshot();
  });

});