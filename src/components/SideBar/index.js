import React, { Component } from 'react';
import './sidebar.css';
import { NavLink } from 'react-router-dom';

import 'normalize.css/normalize.css';
import '@blueprintjs/core/dist/blueprint.css';


class SideBar extends Component {

  // noOverlay
  // TODO: customCrossIcon={<div><div className="pt-icon-standard pt-icon-chevron-left"/></div>}
  render() {
    const navLinksData = (
      [
        {path: '/dashboard', label: 'Dashboard', id: 'dashboard', icon: "pt-icon-dashboard"},
        {path: '/nodes', label: 'Nodes', id: 'nodes', icon: "pt-icon-layout-auto"},
        {path: '/blocks', label: 'Blocks', id: 'blocks', icon: "pt-icon-link"},
        {path: '/transactions', label: 'Transactions', id: 'transactions', icon: "pt-icon-exchange"},
        {path: '/accounts', label: 'Accounts', id: 'accounts', icon: "pt-icon-people"},
        {path: '/contracts', label: 'Contracts', id: 'contracts', icon: "pt-icon-projects"},
      ]
    );

    return (
      <aside className="sidebar">
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
                <span className={data.icon+ " pt-icon"}> </span>
                <span className="menu-text"> {data.label}</span>
              </NavLink>
            )
          }
        </div>
        <hr />
      </aside>
    );
  }
}

export default SideBar;
