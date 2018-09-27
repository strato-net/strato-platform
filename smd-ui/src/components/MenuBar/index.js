import React, { Component } from 'react';
import { withRouter, Link } from 'react-router-dom';
import { connect } from 'react-redux';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import './menubar.css';
import logo from './blockapps-cube-color-430x500.png';
import { env } from '../../env';
import { logout, openLoginOverlay } from '../User/user.actions';
import Login from '../Login';
import WalkThrough from '../WalkThrough';
import { Button } from '@blueprintjs/core';
import { openWalkThroughOverlay } from '../WalkThrough/walkThrough.actions';
import qs from 'query-string';
import { isModePublic } from '../../lib/checkMode';

class MenuBar extends Component {

  componentDidMount(){
    const developerSignIn = Object.keys(qs.parse(this.props.location.search)).includes('developer');
    if(developerSignIn && isModePublic()) {
      this.props.openWalkThroughOverlay(false);
    }
  }

  afterLoggedIn() {
    if (this.props.isLoggedIn || !isModePublic()) {
      return (
        <div>
          <span className="pt-navbar-divider" />
          <a href='/prometheus' target="_black" rel="noopener noreferrer">
            <button className="pt-button pt-minimal pt-small" onClick={() => { mixpanelWrapper.track("prometheus_graphs_clicK") }}>Prometheus Graphs</button>
          </a>
          <a href={env.BLOC_DOC_URL} target="_blank" rel="noopener noreferrer" id="tour-bloc-api-button">
            <button className="pt-button pt-minimal pt-small" onClick={() => { mixpanelWrapper.track("bloc_docs_click") }}>Bloc API</button>
          </a>
          <a href={env.STRATO_DOC_URL} target="_blank" rel="noopener noreferrer">
            <button className="pt-button pt-minimal pt-small" onClick={() => { mixpanelWrapper.track("strato_docs_click") }}>STRATO API</button>
          </a>
          {this.props.isLoggedIn && <span><span className="pt-navbar-divider" />
            <small className="pt-text-muted welcome-user"> Welcome, {this.props.currentUser.username} </small>
            <span className="pt-navbar-divider" />
            <a target="_blank" rel="noopener noreferrer">
              <button className="pt-button pt-minimal pt-small" onClick={() => { this.props.logout() }}>Logout</button>
            </a></span>}
        </div>
      );
    }
  }

  renderDeveloperButton() {
    if (!this.props.isLoggedIn && isModePublic()) {
      return (
        <Button onClick={() => {
          mixpanelWrapper.track('create_user_open_click');
          this.props.openWalkThroughOverlay(false);
        }} text="Developer Sign In" className="pt-button pt-small pt-intent-primary" />
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
          <span className="pt-navbar-divider" />
          <small className="pt-text-muted">SMD v{process.env.REACT_APP_VERSION} - {isModePublic() ? "Public" : "Enterprise"} </small>

          {this.afterLoggedIn()}
        </div>
        {isModePublic() && <div><Login />
          <WalkThrough /></div>}
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

const connected = connect(mapStateToProps, {
  logout,
  openLoginOverlay,
  openWalkThroughOverlay
})(MenuBar);

export default withRouter(connected);
