import React, { Component } from 'react';
import { withRouter, Link } from 'react-router-dom';
import { connect } from 'react-redux';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import './menubar.css';
import logo from './strato-mercata-beta-white.png';
import { env } from '../../env';
import { Popover, Button, Menu, Position, MenuItem, Dialog, Intent, MenuDivider } from '@blueprintjs/core';
import {
  searchQueryRequest,
} from '../SearchResults/searchresults.actions';
import {
  getUserCertificateRequest,
} from "../User/user.actions"
import HexText from '../HexText';

class MenuBar extends Component {
  constructor() {
    super()
    this.state = {
     searchQuery:"",
     isUserMenuOpen: false
    }
  }
  componentWillReceiveProps(newProps) {
    if (newProps.oauthUser && !newProps.userCertificate) {
      this.props.getUserCertificateRequest(newProps.oauthUser.address)
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

  renderUserProfileInfo = () => {
    const { 
      certificateString, 
      organization, 
      organizationalUnit, 
      commonName,
      userAddress,
      block_timestamp
    } = this.props.userCertificate

    const dateCreated = new Date(block_timestamp).toLocaleDateString('en-us', {year:"numeric", month:"short", day:"numeric"}) 

    return (
      <div className='pt-dark'>
        <h3>Organization</h3>
        <h4>{organization} {organizationalUnit ? `| ${organizationalUnit}`: ""}</h4>
        <MenuDivider />

        <h3>Name</h3>
        <h4>{commonName}</h4>
        <MenuDivider />

        <h3>Address</h3>
        <HexText value={'0x' + userAddress}/>

        <h3>Date Created</h3>
        <h4>{dateCreated}</h4>
        <MenuDivider />

        <h3>Certificate <span className='pt-monospace-text'>.pem</span></h3>
        <pre>{certificateString}</pre>
      </div>      
    )
  }


  handleKeyDown = (e) => {

    if(e.keyCode === 13 && this.state.searchQuery!=="") {
      this.props.searchQueryRequest(this.state.searchQuery);
      this.props.history.push('/searchresults')
    }
  }
  
  // on-submit search function calls searchQueryRequest

  toggleDialog = () => {
    this.setState({ isUserMenuOpen: !this.state.isUserMenuOpen })
  }

  afterLoggedIn() {
    const userDropdown =
      <Menu>
        <MenuItem className="pt-button pt-minimal" onClick={this.toggleDialog} target="_blank" rel="noopener noreferrer" iconName="mugshot" text={this.props.userCertificate ? "My Profile" : "More Info"}/> 
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
            {
              this.props.userCertificate ? (
                <div>
                  {this.renderUserProfileInfo()}
                </div> ) 
                : (
                <div>
                  <h4>Your STRATO Mercata address: <br/><HexText value={this.props.oauthUser ? "0x" + this.props.oauthUser.address : null} shorten={false}/></h4><br/>
                  <h4>Your STRATO Mercata account is currently being verified. You should receive an e-mail confirmation when your account is ready. Welcome to the Block!</h4><br/>
                  <MenuDivider />
                  <h5>If your account still hasn't been verified, <a
                      onClick={() => { mixpanelWrapper.track("contact_blockapps_support_click") }}
                      href='https://support.blockapps.net' 
                      target="_blank" 
                      rel="noopener noreferrer">contact support here.</a>
                  </h5>
                </div>
              )
            }
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
            iconName={"user"} 
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

const connected = connect(mapStateToProps, {
  searchQueryRequest, 
  getUserCertificateRequest,
})(MenuBar);

export default withRouter(connected);
