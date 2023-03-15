import React, { Component } from 'react';
import { withRouter, Link } from 'react-router-dom';
import { connect } from 'react-redux';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import './menubar.css';
import logo from './BlockAppsLogos_DarkBG-Stacked.png';
import { env } from '../../env';
import { isOauthEnabled } from '../../lib/checkMode';
import {
  searchQueryRequest,
} from '../SearchResults/searchresults.actions';

class MenuBar extends Component {
  constructor() {
    super()
    this.state = {
     searchQuery:""
    }
  }

  logout() {
    localStorage.removeItem('user');
    window.location.href = '/auth/logout';
  }

  updateSearch = (searchQuery) => {
    // Update local state instead
    this.props.searchQuerySuccess(searchQuery);
    this.setState({ searchQuery: searchQuery });
    console.log("hello?", searchQuery);
  }


  handleKeyDown = (e) => {

    if(e.keyCode === 13 && this.state.searchQuery!="") {
      this.props.searchQueryRequest(this.state.searchQuery);
      this.props.history.push('/searchresults')
    }
  }
  
  // on-submit search function calls searchQueryRequest


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
          { (this.props.oauthUser && this.props.oauthUser.commonName) 
            ? <small className="pt-text-muted welcome-user"> {this.props.oauthUser.commonName} </small>
            : <a href='https://support.blockapps.net ' target="_black" rel="noopener noreferrer">
                <button className="pt-button pt-minimal pt-small" onClick={() => { mixpanelWrapper.track("contact_blockapps_certification_click") }}> Get Certified </button>
              </a>
          }
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

        {/* <div className="pt-navbar-group pt-align-left"> */}
        <div className="col-sm-5 smd-pad-4">
            <div className="pt-input-group pt-dark pt-large">
              <span className="pt-icon pt-icon-search"></span>
                <input
                  className="pt-input"
                  type="search"
                  value={this.state.searchQuery}
                  onChange={(e) => this.setState({searchQuery: e.target.value})}
                  placeholder="Search anything on Mercata"
                  onKeyDown={this.handleKeyDown}
                  dir="auto" />
                  {/* <input type="submit"></input> */}
     
            </div>
            
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
    oauthUser: state.user.oauthUser,
    searchQuery: state.search.searchQuery
  };
}

const connected = connect(mapStateToProps, {searchQueryRequest})(MenuBar);

export default withRouter(connected);
