import React from 'react';
import SideBar from "../../components/SideBar";

describe('Test SideBar index', () => {
  let wrapper;

  beforeEach(() => {
    wrapper = shallow(<SideBar />);
  });

  test('should renders correctly', () => {
    expect(wrapper.debug()).toMatchSnapshot();
  });

  test('should render dashboard link on first position', () => {
    wrapper.find('NavLink').at(0).simulate('click');
    expect(wrapper.find('NavLink').get(0)).toMatchSnapshot();
  });

  test('should render dashboard link on secound position', () => {
    wrapper.find('NavLink').at(1).simulate('click');
    expect(wrapper.find('NavLink').get(1)).toMatchSnapshot();
  });

  test('should render dashboard link on third position', () => {
    wrapper.find('NavLink').at(2).simulate('click');
    expect(wrapper.find('NavLink').get(2)).toMatchSnapshot();
  });

  test('should render dashboard link on fourth position', () => {
    wrapper.find('NavLink').at(3).simulate('click');
    expect(wrapper.find('NavLink').get(3)).toMatchSnapshot();
  });

  test('should render dashboard link on fifth position', () => {
    wrapper.find('NavLink').at(4).simulate('click');
    expect(wrapper.find('NavLink').get(4)).toMatchSnapshot();
  });

  test('should render dashboard link on sixth position', () => {
    wrapper.find('NavLink').at(5).simulate('click');
    expect(wrapper.find('NavLink').get(5)).toMatchSnapshot();
  });

  test('should render dashboard link on seventh position', () => {
    wrapper.find('NavLink').at(6).simulate('click');
    expect(wrapper.find('NavLink').get(6)).toMatchSnapshot();
  });

});