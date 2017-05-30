import React, { Component } from 'react';
import { connect } from 'react-redux';
import { push as preReduxMenu } from 'react-burger-menu'
import './sidebar.css';
import { NavLink } from 'react-router-dom';
import {decorator as reduxBurgerMenu} from 'redux-burger-menu';
import {action as toggleMenu} from 'redux-burger-menu';
import { Colors} from '@blueprintjs/core';

import 'normalize.css/normalize.css';
import '@blueprintjs/core/dist/blueprint.css';


const Menu = reduxBurgerMenu(preReduxMenu);

class SideBar extends Component {

  navLinksData = this.props.navLinksData;

  closeSidebar(e) {
    e.stopPropagation();
    this.props.dispatch(toggleMenu(false));
  }

  render() {
    return (
      <Menu
        pageWrapId={"page-wrap"}
        outerContainerId={"outer-container"}
        // noOverlay
        // TODO: customCrossIcon={<div><div className="pt-icon-standard pt-icon-chevron-left"/></div>}
      >
        {
          this.navLinksData.map(data =>
            <NavLink
              key={data.id}
              id={data.id}
              to={data.path}
              onClick={(e) => this.closeSidebar(e)}
              className="menu-item"
            >
              <span className={data.icon+ " pt-icon-large"}> </span>
              <span className="menu-item"> {data.label}</span>
            </NavLink>
          )
        }
      </Menu>
    );
  }
}

function mapStateToProps(state) {
  return {
    sidebarIsOpen: state.burgerMenu.isOpen,
  };
}

export default connect(mapStateToProps)(SideBar);
