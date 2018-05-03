import {
  fetchApplications,
  fetchApplicationsSuccess,
  fetchApplicationsFailure,
  launchApp,
  launchAppFailure,
  launchAppSuccess,
  selectApp,
  resetSelectedApp
} from '../../components/Applications/applications.actions';
import { applicationData, errorFetchApp, errorLaunchApp } from './applicationsMock';

describe('Applications: action', () => {

  describe('fetch applications', () => {

    test('request', () => {
      expect(fetchApplications()).toMatchSnapshot();
    });

    test('success', () => {
      expect(fetchApplicationsSuccess(applicationData)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(fetchApplicationsFailure(errorFetchApp)).toMatchSnapshot();
    });

  })

  describe('launch app', () => {

    test('request', () => {
      expect(launchApp('e80b681c42f831ea3c4b8db531f5e165', 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/')).toMatchSnapshot();
    });

    test('failure', () => {
      expect(launchAppFailure(errorLaunchApp)).toMatchSnapshot();
    });

    test('success', () => {
      expect(launchAppSuccess('', 'e80b681c42f831ea3c4b8db531f5e165')).toMatchSnapshot();
    });

  });

  describe('select app', () => {

    test('select app', () => {
      expect(selectApp(applicationData[0])).toMatchSnapshot();
    });

    test('reset selected app', () => {
      expect(resetSelectedApp()).toMatchSnapshot();
    });

  });

});