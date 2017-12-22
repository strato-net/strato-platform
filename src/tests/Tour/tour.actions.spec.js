import {
  endTour,
  endAllTours,
  stopAllToursFromAutostarting,
  stopTourAutostart
} from '../../components/Tour/tour.actions';

describe('Test Tour actions', () => {

  test('should load end tour', () => {
    expect(endTour('dashboard')).toMatchSnapshot();
  });

  test('should end all tours', () => {
    expect(endAllTours()).toMatchSnapshot();
  });

  test('should stop all tours from autostarting', () => {
    expect(stopAllToursFromAutostarting()).toMatchSnapshot();
  });

  test('should stop auto tour start', () => {
    expect(stopTourAutostart('dashboard')).toMatchSnapshot();
  });

});