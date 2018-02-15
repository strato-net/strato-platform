import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { connect } from 'react-redux';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import './menubar.css';
import logo from './blockapps-cube-color-430x500.png';
import { env } from '../../env';
import { logout, openLoginOverlay } from '../User/user.actions';
import Login from '../Login';
import CreateUser from '../CreateUser';
import { Button } from '@blueprintjs/core';
import { openOverlay } from '../CreateUser/createUser.actions';

class MenuBar extends Component {

  afterLoggedIn() {
    if (this.props.isLoggedIn) {
      return (
        <div>
          <span className="pt-navbar-divider" />
          <small className="pt-text-muted welcome-user"> Welcome, {this.props.currentUser.username} </small>
          <span className="pt-navbar-divider" />
          <a target="_blank" rel="noopener noreferrer">
            <button className="pt-button pt-minimal pt-small" onClick={() => { this.props.logout() }}>Logout</button>
          </a>
        </div>
      );
    }
  }

  renderDeveloperButton() {
    if (!this.props.isLoggedIn) {
      return (
        <Button onClick={() => {
          this.props.openLoginOverlay();
        }} className="pt-button pt-minimal pt-small menubar-button" id="Login-button" text={'For Developers'} />
      );
    }
  }

  renderSignup() {
    if (!this.props.isLoggedIn) {
      return (
        <Button onClick={() => {
          mixpanelWrapper.track('create_user_open_click');
          this.props.openOverlay();
        }} text="Sign Up" className="pt-button pt-minimal pt-small menubar-button" />
      )
    }
  }

  render() {
    return (
      <nav className="pt-navbar pt-dark smd-menu-bar" >
        <div className="pt-navbar-group pt-align-left">
          <div>
            <Link to="/home">
              <img
                src={logo}
                alt="Blockapps Logo"
                height="32"
                className="smd-menu-logo"
              />
            </Link>
          </div>
        </div>
        <div className="pt-navbar-group pt-align-left">
          <div className="pt-navbar-heading">STRATO Management Dashboard</div>
        </div>
        <div className="pt-navbar-group pt-align-right">
          {this.renderDeveloperButton()}
          {this.renderSignup()}
          <span className="pt-navbar-divider" />
          <small className="pt-text-muted">v{process.env.REACT_APP_VERSION} </small>
          <span className="pt-navbar-divider" />
          <a href={env.BLOC_DOC_URL} target="_blank" rel="noopener noreferrer" id="tour-bloc-api-button">
            <button className="pt-button pt-minimal pt-small" onClick={() => { mixpanelWrapper.track("bloc_docs_click") }}>Bloc API</button>
          </a>
          <a href={env.STRATO_DOC_URL} target="_blank" rel="noopener noreferrer">
            <button className="pt-button pt-minimal pt-small" onClick={() => { mixpanelWrapper.track("strato_docs_click") }}>STRATO API</button>
          </a>
          {this.afterLoggedIn()}
        </div>
        <Login />
        <CreateUser />
      </nav>
    );
  }
}

export function mapStateToProps(state) {
  return {
    isLoggedIn: state.user.isLoggedIn,
    currentUser: state.user.currentUser,
  };
}

export default connect(mapStateToProps, {
  logout,
  openLoginOverlay,
  openOverlay
})(MenuBar);
