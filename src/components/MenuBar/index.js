import React, {Component} from 'react';
import { connect } from 'react-redux';

import {action as toggleMenu} from 'redux-burger-menu';

class MenuBar extends Component {

  openSidebar(e) {
    e.stopPropagation();
    this.props.dispatch(toggleMenu(true));
  }

  render() {
    return (
      <nav className="pt-navbar pt-dark">
        <div className="pt-navbar-group pt-align-left">
          <div id="outer-container">
            <span className="pt-icon-standard pt-icon-menu" onClick={(e) => this.openSidebar(e)} />
          </div>
        </div>
        <div className="pt-navbar-group pt-align-left">
          <div className="pt-navbar-heading">Strato Management Dashboard</div>
        </div>
        <div className="pt-navbar-group pt-align-right">
          <span className="pt-navbar-divider"/>
          <a className="pt-button pt-minimal pt-icon-user"/>
          <a className="pt-button pt-minimal pt-icon-notifications"/>
          <a className="pt-button pt-minimal pt-icon-cog"/>
        </div>
      </nav>
    );
  }
}

function mapStateToProps(state) {
  return {
    sidebarIsOpen: state.burgerMenu.isOpen,
  };
}

export default connect(mapStateToProps)(MenuBar);
