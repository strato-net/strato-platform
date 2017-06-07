import React, { Component } from 'react';
import './sidebar.css';
import { NavLink } from 'react-router-dom';
import logo from './blockapps-logo-horizontal-white.png';

import 'normalize.css/normalize.css';
import '@blueprintjs/core/dist/blueprint.css';


class SideBar extends Component {

  // noOverlay
  // TODO: customCrossIcon={<div><div className="pt-icon-standard pt-icon-chevron-left"/></div>}
  render() {
    const navLinksData = (
      [
        {path: '/dashboard', label: 'Dashboard', id: 'dashboard', icon: "fa-dashboard"},
        //{path: '/nodes', label: 'Nodes', id: 'nodes', icon: "pt-icon-layout-auto"},
        {path: '/blocks', label: 'Blocks', id: 'blocks', icon: "fa-link"},
        {path: '/transactions', label: 'Transactions', id: 'transactions', icon: "fa-exchange"},
        {path: '/accounts', label: 'Accounts', id: 'accounts', icon: "fa-users"},
        {path: '/contracts', label: 'Contracts', id: 'contracts', icon: "fa-gavel"},
      ]
    );

    return (
      <aside>
        <div className="menu">
          {
            navLinksData.map(data =>
              <NavLink
                key={data.id}
                id={data.id}
                to={data.path}
                className="menu-item"
                activeClassName="active-menu-item"
              >
                <i className={ 'fa ' + data.icon }> </i>
                <span className="menu-text"> {data.label}</span>
              </NavLink>
            )
          }
        </div>
        <hr />
        <div>
        </div>
        <div className="smd-sidebar-logo">
          <a href="http://blockapps.net" target="_blank" rel="noopener noreferrer">
            <img
              src={logo}
              width="120"
              alt="Blockapps Logo"
            />
          </a>
        </div>
      </aside>
    );
  }
}

export default SideBar;
