import React, { Component } from 'react';
import { withRouter, Link } from 'react-router-dom';
import { connect } from 'react-redux';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import './menubar.css';
import logo from './BlockAppsLogos_DarkBG-Stacked.png';
import { env } from '../../env';
import { isOauthEnabled } from '../../lib/checkMode';

class MenuBar extends Component {

  logout() {
    localStorage.removeItem('user');
    window.location.href = '/auth/logout';
  }

  login() {
      window.location.replace("https://keycloak.blockapps.net/auth/realms/mercata-testnet/protocol/openid-connect/auth?client_id=mercata-beta-userx&state=e83fa2c9a7bb03ed1985c10d5e9e4679&nonce=71a5e2b940f1d0f79ddc7eebfb9cadae&scope=openid%20email%20profile&response_type=code&redirect_uri=https%3A%2F%2Fuserx1.mercata-beta.blockapps.net%2Fauth%2Fopenidc%2Freturn");
  }

  afterLoggedIn() {
    console.log("Garrett checking props", this.props.oauthUser );
    
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
          { (this.props.oauthUser && this.props.oauthUser.commonName) 
            ? <small className="pt-text-muted welcome-user"> {this.props.oauthUser.commonName} </small>
            : <a href='https://support.blockapps.net ' target="_black" rel="noopener noreferrer">
                <button className="pt-button pt-minimal pt-small" onClick={() => { mixpanelWrapper.track("contact_blockapps_certification_click") }}> Get Certified </button>
              </a>
          }
          <span className="pt-navbar-divider" />
          <a target="_blank" rel="noopener noreferrer">
            <button className="pt-button pt-minimal pt-small" onClick={this.props.isLoggedIn ? this.logout : this.login }>{ this.props.isLoggedIn ? "Logout" : "Login" }</button>
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
          <div className="pt-navbar-heading">STRATO Mercata Dashboard</div>
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
  console.log("What is intial state", state);
  return {
    oauthUser: state.user.oauthUser,
    isLoggedIn : state.user.publicKey != "abcde"
  };
}

const connected = connect(mapStateToProps, {})(MenuBar);

export default withRouter(connected);
