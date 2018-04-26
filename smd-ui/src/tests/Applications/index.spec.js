import React from 'react'
import Applications, { mapStateToProps } from '../../components/Applications/index';
import * as checkMode from '../../lib/checkMode';

describe('Applications: index', () => {


  describe('component with (public mode)', () => {

    beforeAll(() => {
      jest.useFakeTimers()
      checkMode.isModePublic = jest.fn().mockReturnValue(true);
    });

    test('initial values', () => {
      const props = {
        applications: [{
          appName: 'dAPP',
          version: '1.0',
          address: 'e80b681c42f831ea3c4b8db531f5e165',
          url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/',
          isLoading: true
        }],
        fetchApplications: jest.fn(),
        location: {
          search: '?developer'
        },
        isLoggedIn: true
      }
      const wrapper = shallow(<Applications.WrappedComponent {...props} />)
      expect(wrapper.debug()).toMatchSnapshot()
    });

    test('without values', () => {
      const props = {
        applications: [],
        fetchApplications: jest.fn(),
        location: {
          search: ''
        },
        isLoggedIn: false
      }
      const wrapper = shallow(<Applications.WrappedComponent {...props} />)
      expect(wrapper.debug()).toMatchSnapshot()
    });

    test('timers', () => {
      const props = {
        applications: [],
        fetchApplications: jest.fn(),
        location: {
          search: '?developer'
        }
      }
      const wrapper = shallow(<Applications.WrappedComponent {...props} />)
      jest.runOnlyPendingTimers()
      expect(props.fetchApplications).toHaveBeenCalled()
    })

    test('application data', () => {
      const props = {
        applications: [{
          appName: 'dAPP',
          version: '1.0',
          address: 'e80b681c42f831ea3c4b8db531f5e165',
          url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/',
          isLoading: true
        }],
        fetchApplications: jest.fn(),
        location: {
          search: '?developer'
        }
      }
      const wrapper = shallow(<Applications.WrappedComponent {...props} />)
      expect(wrapper).toMatchSnapshot()
    })

  });

  describe('component with (enterprise mode)', () => {

    beforeAll(() => {
      checkMode.isModePublic = jest.fn().mockReturnValue(false);
    });

    test('initial values', () => {
      const props = {
        applications: [{
          appName: 'dAPP',
          version: '1.0',
          address: 'e80b681c42f831ea3c4b8db531f5e165',
          url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/',
          isLoading: true
        }],
        fetchApplications: jest.fn(),
        location: {
          search: '?developer'
        },
        isLoggedIn: true
      }
      const wrapper = shallow(<Applications.WrappedComponent {...props} />)
      expect(wrapper.debug()).toMatchSnapshot();
    });

    test('without values', () => {
      const props = {
        applications: [],
        fetchApplications: jest.fn(),
        location: {
          search: ''
        },
        isLoggedIn: true
      }
      const wrapper = shallow(<Applications.WrappedComponent {...props} />)
      expect(wrapper.debug()).toMatchSnapshot();
    });

  });

  test('mapStateToProps with default state', () => {
    const state = {
      applications: {
        applications: []
      },
      user: {
        isLoggedIn: false
      },
      cli: {
        isTokenOpen: false
      }
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

  test('componentWillUnmount', () => {
    const props = {
      applications: [{
        appName: 'dAPP',
        version: '1.0',
        address: 'e80b681c42f831ea3c4b8db531f5e165',
        url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/',
        isLoading: true
      }],
      fetchApplications: jest.fn(),
      location: {
        search: '?developer'
      }
    }
    const wrapper = shallow(<Applications.WrappedComponent {...props} />
    );
    wrapper.unmount();
    expect(props.fetchApplications).toHaveBeenCalled();
    expect(wrapper).toMatchSnapshot();
  });

})
