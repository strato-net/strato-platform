import React, { Component } from 'react';
import { push as nonReduxMenu } from 'react-burger-menu'
import './sidebar.css';
import { NavLink } from 'react-router-dom';
import {decorator as reduxBurgerMenu} from 'redux-burger-menu';


const Menu = reduxBurgerMenu(nonReduxMenu);

class SideBar extends Component {

  navLinksData = this.props.navLinksData;

  render() {
    return (
      <Menu
        pageWrapId={"page-wrap"}
        outerContainerId={"outer-container"}
        noOverlay
        // TODO: customCrossIcon={<div><div className="pt-icon-standard pt-icon-chevron-left"/></div>}
      >
        {
          this.navLinksData.map(data =>
            <NavLink key={data.id} id={data.id} className="menu-item" to={data.path}>{data.label}</NavLink>
          )
        }
      </Menu>
    );
  }
}

export default SideBar;
