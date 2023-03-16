import React, { Component } from 'react';
import { withRouter, Link } from 'react-router-dom';
import { connect } from 'react-redux';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import './menubar.css';
import logo from './strato-mercata-beta-white.png';
import { env } from '../../env';
import { isOauthEnabled } from '../../lib/checkMode';
import { Popover, Button, Menu, Position, MenuItem, Dialog, Intent } from '@blueprintjs/core';
import {
  searchQueryRequest,
} from '../SearchResults/searchresults.actions';

class MenuBar extends Component {
  constructor() {
    super()
    this.state = {
     searchQuery:"",
     isUserMenuOpen: false
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
  }


  handleKeyDown = (e) => {

    if(e.keyCode === 13 && this.state.searchQuery!=="") {
      this.props.searchQueryRequest(this.state.searchQuery);
      this.props.history.push('/searchresults')
    }
  }
  
  // on-submit search function calls searchQueryRequest
  // TODO move this to userCertificate state/props
  toggleDialog = () => {
    this.setState({ isUserMenuOpen: !this.state.isUserMenuOpen })
  }

  afterLoggedIn() {
    const userDropdown =
      <Menu>
        <MenuItem className="pt-button pt-minimal" onClick={this.toggleDialog} target="_blank" rel="noopener noreferrer" iconName="mugshot" text="My Profile" /> 
        <MenuItem className="pt-button pt-minimal" onClick={this.logout} target="_blank" rel="noopener noreferrer" iconName="log-out" text="Logout" /> 
      </Menu>

    return (
      <div>
        <Dialog
          className="pt-dark"
          iconName="mugshot"
          isOpen={this.state.isUserMenuOpen}
          onClose={this.toggleDialog}
          title="My Profile"
        >
          <div className="pt-dialog-body">
              Some content
          </div>
          <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                  <Button
                      className="pt-minimal"
                      intent={Intent.DANGER}
                      onClick={this.toggleDialog}
                      text="Close"
                  />
              </div>
          </div>
        </Dialog>

        <Popover content={userDropdown} position={Position.BOTTOM_RIGHT}>
          <Button 
            className={"pt-large pt-minimal " + (this.props.userCertificate ? 'pt-intent-primary' : 'pt-intent-warning')} 
            iconName={this.props.userCertificate ? "user" : "social-media"} 
            text={this.props.userCertificate ? (this.props.userCertificate.commonName + ', ' + this.props.userCertificate.organization + 
              (this.props.userCertificate.organizationalUnit ? ': ' + this.props.userCertificate.organizationalUnit : '')) : 'Verification Pending'} />
        </Popover>
      </div>
    );
  }

  render() {
    const helpDropdown = (
      <Menu>
          <MenuItem 
            className="pt-button pt-minimal pt-small" 
            onClick={() => { mixpanelWrapper.track("docs_blockapps_click") }} 
            href='https://docs.blockapps.net/' 
            target="_blank" 
            rel="noopener noreferrer" 
            iconName="document"
            text="Documentation" />
          <MenuItem className="pt-button pt-minimal pt-small" 
            onClick={() => { mixpanelWrapper.track("contact_blockapps_support_click") }}
            href='https://support.blockapps.net' 
            target="_blank" 
            rel="noopener noreferrer" 
            iconName="headset" 
            text="Support" />
          <small className="pt-text-muted pt-align-right">STRATO {env.STRATO_VERSION}</small>
      </Menu>
    );

    return (
      <nav className="pt-navbar pt-dark smd-menu-bar" >
        <div className="pt-navbar-group pt-align-left col-sm-2 ">
          <div>
            <Link to="/home">
              <img
                src={logo}
                alt="Blockapps Logo"
                height="45"
                className="smd-menu-logo smd-pad-4"
              />
            </Link>
          </div>
        </div>
        {/* <div className="pt-navbar-group pt-align-left"> */}
          {/* <div className="pt-navbar-heading">STRATO Mercata Dashboard</div> */}
        {/* </div> */}

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
          {this.afterLoggedIn()}
          <Popover content={helpDropdown} position={Position.BOTTOM_RIGHT}>
            <Button className="pt-minimal pt-large" style={{ marginLeft: 10}} iconName="help"/>
          </Popover>
        </div>
      </nav>
    );
  }
}

export function mapStateToProps(state) {
  return {
    oauthUser: state.user.oauthUser,
    userCertificate: state.user.userCertificate,
    searchQuery: state.search.searchQuery
  };
}

const connected = connect(mapStateToProps, {searchQueryRequest})(MenuBar);

export default withRouter(connected);
