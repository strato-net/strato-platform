import React from 'react'
import ApplicationCard, { mapStateToProps } from '../../components/ApplicationCard/index'
import * as checkMode from '../../lib/checkMode';

describe('ApplicationCard: index', () => {

  describe('for public mode', () => {
    beforeAll(() => {
      checkMode.isModePublic = jest.fn().mockReturnValue(true);
    })
    describe('set initial state with', () => {
      test('no values', () => {
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
        expect(wrapper.debug()).toMatchSnapshot()
      })
      test('values', () => {
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
        expect(wrapper.debug()).toMatchSnapshot()
      })
    })
    test('simulate launch app click when user is logged in', () => {
      const props = {
        app: {
          appName: 'dAPP',
          version: '1.0',
          address: 'e80b681c42f831ea3c4b8db531f5e165',
          url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/',
          isLoading: false
        },
        launchApp: jest.fn(),
        isLoggedIn: true
      }
      const wrapper = shallow(<ApplicationCard.WrappedComponent {...props} />)
      wrapper.find('button').at(1).simulate('click')
      expect(props.launchApp).toHaveBeenCalled()
    })

    test('simulate launch app click when user is not logged in', () => {
      const props = {
        app: {
          appName: 'dAPP',
          version: '1.0',
          address: 'e80b681c42f831ea3c4b8db531f5e165',
          url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/',
          isLoading: false
        },
        launchApp: jest.fn(),
        isLoggedIn: false,
        openWalkThroughOverlay: jest.fn(),
        selectApp: jest.fn(),
      }
      const wrapper = shallow(<ApplicationCard.WrappedComponent {...props} />)
      wrapper.find('Button').simulate('click')
      expect(props.openWalkThroughOverlay).toHaveBeenCalled()
      expect(props.selectApp).toHaveBeenCalled()
    })
  })

  describe('for enterprise mode', () => {
    beforeAll(() => {
      checkMode.isModePublic = jest.fn().mockReturnValue(false);
    })
    describe('set initial state with', () => {
      test('no values', () => {
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
        expect(wrapper.debug()).toMatchSnapshot()
      })
      test('values', () => {
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
        expect(wrapper.debug()).toMatchSnapshot()
      })
    })
    test('simulate launch app click', () => {
      const props = {
        app: {
          appName: 'dAPP',
          version: '1.0',
          address: 'e80b681c42f831ea3c4b8db531f5e165',
          url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/',
          isLoading: false
        },
        launchApp: jest.fn(),
        isLoggedIn: true
      }
      const wrapper = shallow(<ApplicationCard.WrappedComponent {...props} />)
      wrapper.find('button').at(1).simulate('click')
      expect(props.launchApp).toHaveBeenCalled()
    })
  })

  test('mapStateToProps with default state', () => {
    const state = {
      applications: {
        isLoading: false,
        url: 'http://stratodev.blockapps.net/apps/e80b681c42f831ea3c4b8db531f5e165/'
      },
      user: {
        isLoggedIn: false
      }
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

})