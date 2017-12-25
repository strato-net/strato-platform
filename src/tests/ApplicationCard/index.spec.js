import React from 'react'
import ApplicationCard, { mapStateToProps } from '../../components/ApplicationCard/index'

describe('Test application card', () => {

  test('should test abc', () => {
    const props = {
      app: {
        appName: undefined,
        version: undefined,
        address: undefined,
        url: undefined,
        isLoading: false
      },
      launchApp: jest.fn()
    }
    const wrapper = shallow(<ApplicationCard.WrappedComponent {...props} />)
    expect(wrapper).toMatchSnapshot()
  })

  test('should test abc', () => {
    const props = {
      app: {
        appName: 'dAPP',
        version: '1.0',
        address: 'e80b681c42f831ea3c4b8db531f5e165',
        url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/',
        isLoading: true
      },
      launchApp: jest.fn()
    }
    const wrapper = shallow(<ApplicationCard.WrappedComponent {...props} />)
    expect(wrapper).toMatchSnapshot()
  })

  test('should test button click action', () => {
    const props = {
      app: {
        appName: 'dAPP',
        version: '1.0',
        address: 'e80b681c42f831ea3c4b8db531f5e165',
        url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/',
        isLoading: false
      },
      launchApp: jest.fn()
    }
    const wrapper = shallow(<ApplicationCard.WrappedComponent {...props} />)
    wrapper.find('button').simulate('click')
    expect(props.launchApp).toHaveBeenCalled()
  })

  test('should test mapStateToProps function only with queryengine as a state', () => {
    const state = {
      applications: {
        isLoading: false,
        url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/'
      }
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

})