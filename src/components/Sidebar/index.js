import React, { Component } from 'react';
import {decorator as reduxBurgerMenu} from 'redux-burger-menu';
import { push as Menu } from 'react-burger-menu'
import './sidebar.css';
import { NavLink } from 'react-router-dom';

class Sidebar extends Component {

  navLinksData = this.props.navLinksData;

  render() {
    return (
      <Menu pageWrapId={ "page-wrap" } outerContainerId={ "outer-container" }>
        {
          this.navLinksData.map(
            data =>
              <NavLink key={data.id} id={data.id} className="menu-item" to={data.path}>{data.label}</NavLink>
          )
        }
      </Menu>
    );
  }
}

export default reduxBurgerMenu(Sidebar);
