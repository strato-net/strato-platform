import React from 'react'
import Applications, { mapStateToProps } from '../../components/Applications/index'

describe('Test applications', () => {
  test('should test applications component with initial values', () => {
    const props = {
      applications: [],
      fetchApplications: jest.fn()
    }
    const wrapper = shallow(<Applications.WrappedComponent {...props} />)
    expect(wrapper).toMatchSnapshot()
  })

  test('should test applications component with application values', () => {
    const props = {
      applications: [{
        appName: 'dAPP',
        version: '1.0',
        address: 'e80b681c42f831ea3c4b8db531f5e165',
        url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/',
        isLoading: true
      }],
      fetchApplications: jest.fn()
    }
    const wrapper = shallow(<Applications.WrappedComponent {...props} />)
    expect(wrapper).toMatchSnapshot()
  })

  test('should test mapStateToProps function only with applications as a state', () => {
    const state = {
      applications: {
        applications: []
      }
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

  test('should invoke componentWillUnmount', () => {
    const props = {
      applications: [{
        appName: 'dAPP',
        version: '1.0',
        address: 'e80b681c42f831ea3c4b8db531f5e165',
        url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/',
        isLoading: true
      }],
      fetchApplications: jest.fn()
    }

    const wrapper = shallow(<Applications.WrappedComponent {...props} />
    );

    wrapper.instance().componentWillUnmount();
    expect(props.fetchApplications).toHaveBeenCalled();
    expect(wrapper).toMatchSnapshot();
  });

})
