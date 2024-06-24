import React from 'react';
import SideBar from "../../components/SideBar";
import * as checkMode from '../../lib/checkMode';
import * as checkS3Credentials from '../../lib/checkS3Credentials';

describe('SideBar: index', () => {
  let wrapper;

  test('render component for public mode', () => {
    checkMode.isOauthEnabled = jest.fn().mockReturnValue(true);
    checkS3Credentials.isS3Available = jest.fn().mockReturnValue(false);
    wrapper = shallow(<SideBar />);
    expect(wrapper.debug()).toMatchSnapshot();
  });

  test('render component for non oauth mode', () => {
    checkMode.isOauthEnabled = jest.fn().mockReturnValue(false);
    checkS3Credentials.isS3Available = jest.fn().mockReturnValue(true);
    wrapper = shallow(<SideBar />);
    expect(wrapper.debug()).toMatchSnapshot();
  });

  describe('sequence of links for oauth and non-oauth mode', () => {

    beforeEach(() => {
      checkMode.isOauthEnabled = jest.fn().mockReturnValue(false);
      checkS3Credentials.isS3Available = jest.fn().mockReturnValue(true);
      wrapper = shallow(<SideBar />);
    });

    test('first position /home', () => {
      wrapper.find('NavLink').at(0).simulate('click');
      expect(wrapper.find('NavLink').get(0)).toMatchSnapshot();
    });

    test('third position /blocks', () => {
      wrapper.find('NavLink').at(2).simulate('click');
      expect(wrapper.find('NavLink').get(2)).toMatchSnapshot();
    });

    test('fourth position /transactions', () => {
      wrapper.find('NavLink').at(3).simulate('click');
      expect(wrapper.find('NavLink').get(3)).toMatchSnapshot();
    });

    test('fifth position /accounts', () => {
      wrapper.find('NavLink').at(4).simulate('click');
      expect(wrapper.find('NavLink').get(4)).toMatchSnapshot();
    });

    test('sixth position /contracts', () => {
      wrapper.find('NavLink').at(5).simulate('click');
      expect(wrapper.find('NavLink').get(5)).toMatchSnapshot();
    });

    test('seventh position /code_editor', () => {
      wrapper.find('NavLink').at(6).simulate('click');
      expect(wrapper.find('NavLink').get(6)).toMatchSnapshot();
    });
    
    test('eighth position /external-storage', () => {
      wrapper.find('NavLink').at(1).simulate('click');
      expect(wrapper.find('NavLink').get(1)).toMatchSnapshot();
    });

  });

});