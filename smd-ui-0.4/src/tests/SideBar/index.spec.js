import React from 'react';
import SideBar from "../../components/SideBar";

describe('SideBar: index', () => {
  let wrapper;

  beforeEach(() => {
    wrapper = shallow(<SideBar />);
  });

  test('render component', () => {
    expect(wrapper.debug()).toMatchSnapshot();
  });

  describe('sequence of links', () => {

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

    test('seventh position /apps', () => {
      wrapper.find('NavLink').at(6).simulate('click');
      expect(wrapper.find('NavLink').get(6)).toMatchSnapshot();
    });

  });

});