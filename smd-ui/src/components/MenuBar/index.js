import React, { Component } from 'react';
import { withRouter, Link } from 'react-router-dom';
import { connect } from 'react-redux';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import './menubar.css';
import logo from './blockapps-cube-color-430x500.png';
import { env } from '../../env';
import { logout } from '../User/user.actions';
import qs from 'query-string';
import { isModePublic, isModeOauth } from '../../lib/checkMode';
import { Field, reduxForm } from 'redux-form';
import { selectChain, fetchChainIds } from '../Chains/chains.actions';

class MenuBar extends Component {

  componentDidMount() {
    const developerSignIn = Object.keys(qs.parse(this.props.location.search)).includes('developer');
    if (developerSignIn && isModePublic()) {
      this.props.openWalkThroughOverlay(false);
    }
    this.props.fetchChainIds();
  }

  afterLoggedIn() {
    if (this.props.isLoggedIn || !isModePublic()) {
      return (
        <div>
          <span className="pt-navbar-divider" />
          <a href='/prometheus' target="_black" rel="noopener noreferrer">
            <button className="pt-button pt-minimal pt-small" onClick={() => { mixpanelWrapper.track("prometheus_graphs_click") }}>Prometheus Graphs</button>
          </a>
          {/*<a href={env.BLOC_DOC_URL} target="_blank" rel="noopener noreferrer" id="tour-bloc-api-button">*/}
            {/*<button className="pt-button pt-minimal pt-small" onClick={() => { mixpanelWrapper.track("bloc_docs_click") }}>Bloc API</button>*/}
          {/*</a>*/}
          {/*<a href={env.STRATO_DOC_URL} target="_blank" rel="noopener noreferrer">*/}
            {/*<button className="pt-button pt-minimal pt-small" onClick={() => { mixpanelWrapper.track("strato_docs_click") }}>STRATO API</button>*/}
          {/*</a>*/}
          {/* TODO: remove public mode and remove logout (unused code) */}
          {this.props.isLoggedIn && <span><span className="pt-navbar-divider" />
            <small className="pt-text-muted welcome-user"> Welcome, {this.props.currentUser.username} </small>
            <span className="pt-navbar-divider" />
            <a target="_blank" rel="noopener noreferrer">
              <button className="pt-button pt-minimal pt-small" onClick={() => { this.props.logout() }}>Logout</button>
            </a></span>}
          {isModeOauth() && <span><span className="pt-navbar-divider" />
            <small className="pt-text-muted welcome-user"> {this.props.oauthUser ? this.props.oauthUser.username : ''} </small>
            <span className="pt-navbar-divider" />
            <a target="_blank" rel="noopener noreferrer">
              <button className="pt-button pt-minimal pt-small" onClick={() => { 
                localStorage.removeItem('user');
                window.location.href = '/auth/logout' 
              }}>Logout</button>
            </a></span>}
        </div>
      );
    }
  }

  renderChainDropDown() {
    if ( this.props.chainIds.length && (this.props.isLoggedIn || !isModePublic())) {
      return (
        <span>
          <span className="pt-navbar-divider"/>
          <small className="pt-text-muted">
            <div className="pt-select">
              <Field
                className="pt-input select-chain"
                component="select"
                name="chainLabel"
                onChange={
                  (e) => {
                    const data = e.target.value === 'Main Chain' ? null : e.target.value;
                    this.props.selectChain(data);
                  }
                }
                required
              >
                <option> Main Chain </option>
                {
                  this.props.chainIds.map((label, i) => {
                    return (
                      <option key={label.id} value={label.id}>{label.label}</option>
                    )
                  })
                }
              </Field>
            </div>
          </small>
          <span className="pt-navbar-divider" />
        </span>
      );
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
          {this.renderChainDropDown()}
          <small className="pt-text-muted">STRATO {env.STRATO_VERSION}</small>
          {this.afterLoggedIn()}
        </div>
      </nav>
    );
  }
}

export function mapStateToProps(state) {
  return {
    isLoggedIn: state.user.isLoggedIn,
    currentUser: state.user.currentUser,
    chainIds: state.chains.chainIds,
    oauthUser: state.user.oauthUser
  };
}

const formed = reduxForm({ form: 'menu-bar' })(MenuBar);
const connected = connect(mapStateToProps, {
  logout,
  selectChain,
  fetchChainIds
})(formed);

export default withRouter(connected);
