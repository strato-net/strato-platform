import {
  fetchApplications,
  fetchApplicationsSuccess,
  fetchApplicationsFailure,
  launchApp,
  launchAppFailure,
  launchAppSuccess
} from '../../components/Applications/applications.actions';
import { applicationData, errorFetchApp, errorLaunchApp } from './applicationsMock';

describe('Test contracts actions', () => {

  test('should create an action to fetch applications', () => {
    expect(fetchApplications()).toMatchSnapshot();
  });

  test('should return applications after successfull response', () => {
    expect(fetchApplicationsSuccess(applicationData)).toMatchSnapshot();
  });

  test('should return error after failure response', () => {
    expect(fetchApplicationsFailure(errorFetchApp)).toMatchSnapshot();
  });

  test('should request launch app', () => {
    expect(launchApp('e80b681c42f831ea3c4b8db531f5e165', 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/')).toMatchSnapshot();
  });

  test('should set error on launch app failure', () => {
    expect(launchAppFailure(errorLaunchApp)).toMatchSnapshot();
  });

  test('should launch app on success response', () => {
    expect(launchAppSuccess('', 'e80b681c42f831ea3c4b8db531f5e165')).toMatchSnapshot();
  });

});