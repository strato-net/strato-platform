import React, { Component } from 'react';
import { withRouter, Link } from 'react-router-dom';
import { connect } from 'react-redux';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import './menubar.css';
import logo from './BlockAppsLogos_DarkBG-Stacked.png';
import { env } from '../../env';
import { isOauthEnabled } from '../../lib/checkMode';
import { reduxForm } from 'redux-form';
import { selectChain, fetchChainIds } from '../Chains/chains.actions';

class MenuBar extends Component {

  logout() {
    localStorage.removeItem('user');
    window.location.href = '/auth/logout';
  }

  afterLoggedIn() {
    return (
      <div>
        <span className="pt-navbar-divider" />
        <a href='https://support.blockapps.net ' target="_black" rel="noopener noreferrer">
          <button className="pt-button pt-minimal pt-small" onClick={() => { mixpanelWrapper.track("contact_blockapps_support_click") }}>Contact BlockApps Support</button>
        </a>
        <span className="pt-navbar-divider" />
        <a href='https://docs.blockapps.net/' target="_black" rel="noopener noreferrer">
          <button className="pt-button pt-minimal pt-small" onClick={() => { mixpanelWrapper.track("docs_blockapps_click") }}>Dev Docs</button>
        </a>
        {isOauthEnabled() && <span><span className="pt-navbar-divider" />
          <small className="pt-text-muted welcome-user"> {this.props.oauthUser ? this.props.oauthUser.commonName : ''} </small>
          <span className="pt-navbar-divider" />
          <a target="_blank" rel="noopener noreferrer">
            <button className="pt-button pt-minimal pt-small" onClick={this.logout}>Logout</button>
          </a></span>}
      </div>
    );
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
                height="50"
                className="smd-menu-logo"
              />
            </Link>
          </div>
        </div>
        <div className="pt-navbar-group pt-align-left">
          <div className="pt-navbar-heading">STRATO Management Dashboard</div>
        </div>
        <div className="pt-navbar-group pt-align-right">
          <small className="pt-text-muted">STRATO {env.STRATO_VERSION}</small>
          {this.afterLoggedIn()}
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

const formed = reduxForm({ form: 'menu-bar' })(MenuBar);
const connected = connect(mapStateToProps, {
  selectChain,
  fetchChainIds
})(formed);

export default withRouter(connected);
