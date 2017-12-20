import {
  endTour,
  endAllTours,
  stopAllToursFromAutostarting,
  stopTourAutostart
} from '../../components/Tour/tour.actions';

describe('Test Tour actions', () => {

  it('should load end tour', () => {
    expect(endTour('dashboard')).toMatchSnapshot();
  });

  it('should end all tours', () => {
    expect(endAllTours()).toMatchSnapshot();
  });

  it('should stop all tours from autostarting', () => {
    expect(stopAllToursFromAutostarting()).toMatchSnapshot();
  });

  it('should stop auto tour start', () => {
    expect(stopTourAutostart('dashboard')).toMatchSnapshot();
  });

});