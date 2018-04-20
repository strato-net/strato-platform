import {
  openWalkThroughOverlay,
  closeWalkThroughOverlay
} from '../../components/WalkThrough/walkThrough.actions';

describe('WalkThrough: actions', () => {
  test('open modal', () => {
    expect(openWalkThroughOverlay(false)).toMatchSnapshot();
  })

  test('close modal', () => {
    expect(closeWalkThroughOverlay()).toMatchSnapshot();
  })
});