import reducer from '../../components/Applications/applications.reducer';
import { applicationData, errorFetchApp, errorLaunchApp } from "./applicationsMock";
import {
  fetchApplications,
  fetchApplicationsFailure,
  fetchApplicationsSuccess,
  launchApp,
  launchAppFailure,
  launchAppSuccess
} from '../../components/Applications/applications.actions';
import { deepClone } from '../helper/testHelper';

describe('Test applications reducer', () => {

  // INITIAL_STATE
  test('should set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  // FETCH_APPLICATIONS_SUCCESSFUL
  test('should store app list after fetchApplication success', () => {
    const action = fetchApplicationsSuccess(applicationData);

    const initialState = {
      applications: [],
      error: null,
      hash: null
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // FETCH_APPLICATIONS_FAILURE
  test('should update error if fetchApplication failed', () => {
    const action = fetchApplicationsFailure(errorFetchApp);

    const initialState = {
      applications: [],
      error: null,
      hash: null
    };

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // LAUNCH APPLICATIONS
  test('should store app list after launchApp success', () => {
    const action = launchApp('e80b681c42f831ea3c4b8db531f5e165', 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/');

    const initialState = {
      applications: applicationData,
      error: null,
      hash: null
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // LAUNCH APPLICATIONS
  test('should store app list after launchApp success', () => {
    const action = launchApp('38a757f8a75453346dcb8149d52df09549f25562', 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/');

    const initialState = {
      applications: applicationData,
      error: null,
      hash: null
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // LAUNCH APPLICATIONS_SUCCESS
  test('should store app list after launchAppSuccess success with different app address', () => {
    const action = launchAppSuccess('', 'e80b681c42f831ea3c4b8db531f5e165')

    const initialState = {
      applications: applicationData,
      error: null,
      hash: null
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // LAUNCH APPLICATIONS_SUCCESS
  test('should store app list after launchAppSuccess success having same app address', () => {
    const action = launchAppSuccess('', '38a757f8a75453346dcb8149d52df09549f25562')

    const initialState = {
      applications: applicationData,
      error: null,
      hash: null
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // LAUNCH APPLICATIONS_FAILURE
  test('should store error launchAppFailure', () => {
    const action = launchAppFailure(errorLaunchApp)

    const initialState = {
      applications: applicationData,
      error: null,
      hash: null
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

  // LAUNCH APPLICATIONS_FAILURE
  test('should store error on launchApp exception', () => {
    const action = launchAppFailure(errorLaunchApp)

    const initialState = {
      applications: applicationData,
      error: null,
      hash: null
    }

    expect(reducer(initialState, action)).toMatchSnapshot();
  })

})
