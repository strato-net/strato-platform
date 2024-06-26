import React, { Component } from 'react';
import './sidebar.css';
import { NavLink } from 'react-router-dom';
import logo from './BlockAppsLogos_DarkBG-Horizontal.png';

import 'normalize.css/normalize.css';
import '@blueprintjs/core/dist/blueprint.css';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { isS3Available } from '../../lib/checkS3Credentials';

class SideBar extends Component {

  // noOverlay
  // TODO: customCrossIcon={<div><div className="pt-icon-standard pt-icon-chevron-left"/></div>}
  render() {
    const navLinksData = (
      [
        //{path: '/nodes', label: 'Nodes', id: 'nodes', icon: "pt-icon-layout-auto"},
        { path: '/home', label: 'Network Stats', id: 'network_stats', icon: "fa-chart-simple" },
        { path: '/accounts', label: 'Users', id: 'accounts', icon: "fa-users" },
        { path: '/transactions', label: 'Transactions', id: 'transactions', icon: "fa-exchange" },
        { path: '/contracts', label: 'Contracts', id: 'contracts', icon: "fa-file-contract" },
        { path: '/blocks', label: 'Blocks', id: 'blocks', icon: "fa-cube" },
        { path: '/code_editor', label: 'Contract Editor', id: 'code_editor', icon: "fa-code" },
      ]
    );

    return (
      <aside id="sidebar" className={this.props.isCollapsed ? '' : 'sidebar-expand'}>
        <div className="menu">
          {
            navLinksData.map(data =>
              <NavLink
                key={data.id}
                id={data.id}
                to={data.path}
                className="menu-item"
                activeClassName="active-menu-item"
                onClick={this.props.toggleCollapse}
              >
                <i className={'fa ' + data.icon}> </i>
                <span className="menu-text"> {data.label}</span>
              </NavLink>
            )
          }
          {isS3Available() &&
            <NavLink
              id={'external_storage'}
              to={'/external_storage'}
              className="menu-item"
              activeClassName="active-menu-item"
              onClick={() => { mixpanelWrapper.track('nav_link_external_storage_click') }}
            >
              <i className='fa fa-cloud-upload'> </i>
              <span className="menu-text">External Storage</span>
            </NavLink>}
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
