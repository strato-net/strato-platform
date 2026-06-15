import {
  endTour,
  endAllTours,
  stopAllToursFromAutostarting,
  stopTourAutostart
} from '../../components/Tour/tour.actions';

describe('Tour: actions', () => {

  test('end tour', () => {
    expect(endTour('dashboard')).toMatchSnapshot();
  });

  test('end all tours', () => {
    expect(endAllTours()).toMatchSnapshot();
  });

  test('stop all tours from autostarting', () => {
    expect(stopAllToursFromAutostarting()).toMatchSnapshot();
  });

  test('stop auto tour start', () => {
    expect(stopTourAutostart('dashboard')).toMatchSnapshot();
  });

});