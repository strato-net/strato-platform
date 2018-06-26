import React from 'react';
import SideBar from "../../components/SideBar";
import * as checkMode from '../../lib/checkMode';

describe('SideBar: index', () => {
  let wrapper;

  test('render component for public mode', () => {
    checkMode.isModePublic = jest.fn().mockReturnValue(true);
    wrapper = shallow(<SideBar />);
    expect(wrapper.debug()).toMatchSnapshot();
  });

  describe('sequence of links for public mode', () => {

    beforeEach(() => {
      checkMode.isModePublic = jest.fn().mockReturnValue(true);
      wrapper = shallow(<SideBar />);
    });

    test('first position /apps', () => {
      wrapper.find('NavLink').at(0).simulate('click');
      expect(wrapper.find('NavLink').get(0)).toMatchSnapshot();
    });

    test('secound position /home', () => {
      wrapper.find('NavLink').at(1).simulate('click');
      expect(wrapper.find('NavLink').get(1)).toMatchSnapshot();
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

    test('eight position /external-storage', () => {
      wrapper.find('NavLink').at(7).simulate('click');
      expect(wrapper.find('NavLink').get(7)).toMatchSnapshot();
    });

  });

  test('render component for enterprise mode', () => {
    checkMode.isModePublic = jest.fn().mockReturnValue(false);
    wrapper = shallow(<SideBar />);
    expect(wrapper.debug()).toMatchSnapshot();
  });

  describe('sequence of links for enterprise mode', () => {

    beforeEach(() => {
      checkMode.isModePublic = jest.fn().mockReturnValue(false);
      wrapper = shallow(<SideBar />);
    });

    test('first position /home', () => {
      wrapper.find('NavLink').at(0).simulate('click');
      expect(wrapper.find('NavLink').get(0)).toMatchSnapshot();
    });

    test('secound position /blocks', () => {
      wrapper.find('NavLink').at(1).simulate('click');
      expect(wrapper.find('NavLink').get(1)).toMatchSnapshot();
    });

    test('third position /transactions', () => {
      wrapper.find('NavLink').at(2).simulate('click');
      expect(wrapper.find('NavLink').get(2)).toMatchSnapshot();
    });

    test('fourth position /accounts', () => {
      wrapper.find('NavLink').at(3).simulate('click');
      expect(wrapper.find('NavLink').get(3)).toMatchSnapshot();
    });

    test('fifth position /contracts', () => {
      wrapper.find('NavLink').at(4).simulate('click');
      expect(wrapper.find('NavLink').get(4)).toMatchSnapshot();
    });

    test('sixth position /code_editor', () => {
      wrapper.find('NavLink').at(5).simulate('click');
      expect(wrapper.find('NavLink').get(5)).toMatchSnapshot();
    });
    
    test('seventh position /external-storage', () => {
      wrapper.find('NavLink').at(6).simulate('click');
      expect(wrapper.find('NavLink').get(6)).toMatchSnapshot();
    });

    test('eight position /apps', () => {
      wrapper.find('NavLink').at(7).simulate('click');
      expect(wrapper.find('NavLink').get(7)).toMatchSnapshot();
    });


  });

});