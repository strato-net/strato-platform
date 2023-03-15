import React, { Component } from 'react';
import { withRouter, Link } from 'react-router-dom';
import { connect } from 'react-redux';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import './menubar.css';
import logo from './BlockAppsLogos_DarkBG-Stacked.png';
import { env } from '../../env';
import { isOauthEnabled } from '../../lib/checkMode';
import { Popover, Button, Menu, Position, MenuItem, MenuDivider  } from '@blueprintjs/core';

class MenuBar extends Component {

  logout() {
    localStorage.removeItem('user');
    window.location.href = '/auth/logout';
  }

  afterLoggedIn() {
    const userDropdown = this.props.oauthUser ? 
      <Menu>
        <MenuItem className="pt-button pt-minimal pt-small" onClick={this.logout} target="_blank" rel="noopener noreferrer" iconName="log-out" text="Logout" /> 
      </Menu>
      : null 

    return (
      <div>
        <Popover content={userDropdown} position={Position.BOTTOM_RIGHT}>
          <Button disabled={!this.props.oauthUser || !isOauthEnabled()} iconName={this.props.oauthUser ? "user" : "social-media"} text={this.props.oauthUser ? this.props.oauthUser.commonName : 'Verification Pending'} />
        </Popover>
      </div>
    );
  }

  render() {
    const helpDropdown = (
      <Menu>
          <MenuItem className="pt-button pt-minimal pt-small" onClick={() => { mixpanelWrapper.track("docs_blockapps_click") }} href='https://docs.blockapps.net/' target="_black" rel="noopener noreferrer" iconName="document" text="Documentation" />
          <MenuItem className="pt-button pt-minimal pt-small" onClick={() => { mixpanelWrapper.track("contact_blockapps_support_click") }} href='https://support.blockapps.net' target="_black" rel="noopener noreferrer" iconName="headset" text="Contact Us" />
          <small className="pt-text-muted pt-align-right">STRATO {env.STRATO_VERSION}</small>
      </Menu>
    );

    return (
      <nav className="pt-navbar pt-dark smd-menu-bar" >
        <div className="pt-navbar-group pt-align-left">
          <div>
            <Link to="/home">
              <img
                src={logo}
                alt="Blockapps Logo"
                height="50"
                className="smd-menu-logo"
              />
            </Link>
          </div>
        </div>
        <div className="pt-navbar-group pt-align-left">
          <div className="pt-navbar-heading">STRATO Mercata Dashboard</div>
        </div>
        <div className="pt-navbar-group pt-align-right">
          {this.afterLoggedIn()}
          <Popover content={helpDropdown} position={Position.BOTTOM_RIGHT}>
            <Button style={{ marginLeft: 10}} iconName="help"/>
          </Popover>
        </div>
      </nav>
    );
  }
}

export function mapStateToProps(state) {
  return {
    oauthUser: state.user.oauthUser
  };
}

const connected = connect(mapStateToProps, {})(MenuBar);

export default withRouter(connected);
