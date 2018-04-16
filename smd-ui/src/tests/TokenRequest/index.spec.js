import TokenRequest, { mapStateToProps } from '../../components/TokenRequest'
import React from 'react'

describe('TokenRequest: index', () => {

  describe('render component', () => {

    test('when modal is close', () => {
      const props = {
        isTokenOpen: false,
        currentUser: {
          accountAddress: '123456789012345678901234567890123'
        }
      }
      const wrapper = shallow(
        <TokenRequest.WrappedComponent {...props} />
      );
      expect(wrapper).toMatchSnapshot();
    });

    test('when modal is open', () => {
      const props = {
        isTokenOpen: true,
        currentUser: {
          accountAddress: '123456789012345678901234567890123'
        }
      }
      const wrapper = shallow(
        <TokenRequest.WrappedComponent {...props} />
      );
      expect(wrapper).toMatchSnapshot();
    });

  })

  test('close modal on button click', () => {
    const props = {
      isTokenOpen: true,
      currentUser: {
        accountAddress: '123456789012345678901234567890123'
      },
      closeTokenRequestOverlay: jest.fn()
    }
    const wrapper = shallow(
      <TokenRequest.WrappedComponent {...props} />
    ).find('Dialog').dive();
    wrapper.find('button').simulate('click');
    expect(props.closeTokenRequestOverlay).toHaveBeenCalled();
  })

  test('mapStateToProps with default state', () => {
    const state = {
      tokenRequest: {
        isTokenOpen: true
      },
      user: {
        currentUser: {
          accountAddress: '123456789012345678901234567890123'
        }
      }
    };

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

})