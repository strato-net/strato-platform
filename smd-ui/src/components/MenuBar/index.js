import React, { Component } from 'react';
import { withRouter, Link } from 'react-router-dom';
import { connect } from 'react-redux';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import './menubar.css';
import logo from './strato-mercata-beta-white.png';
import { env } from '../../env';
import { isOauthEnabled } from '../../lib/checkMode';

class MenuBar extends Component {
  state = {
    isModalOpen: false,
  }

  logout() {
    localStorage.removeItem('user');
    window.location.href = '/auth/logout';
  }

  openModal = () => {
    this.setState({ isModalOpen: true });
  }

  closeModal = () => {
    this.setState({ isModalOpen: false });
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
        <span className="pt-navbar-divider" />
        <button className="pt-button pt-minimal pt-small" onClick={this.openModal}>Invite Colleague</button>
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

  sendInvite = () => {
    const customInviteLink = "https://bit.ly/MercataSignUp";
    const subject = "Invitation to join Mercata";
    // check to see if the user is logged in and has a common name
    const userName = (this.props.oauthUser && this.props.oauthUser.commonName) ? this.props.oauthUser.commonName : "_______";




    const body = `Hi! ${userName} would like to invite you to join Mercata. Please follow this link to sign up: <a href="${customInviteLink}">${customInviteLink}</a> Thank you!`;

    const mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoLink;
  }

  copyTextToClipboard = () => {
    const textField = document.createElement('textarea');
    const customInviteLink = "https://bit.ly/MercataSignUp";
    const body = `Hi! ${(this.props.oauthUser && this.props.oauthUser.commonName) ? this.props.oauthUser.commonName : "_______"} would like to invite you to join Mercata. Please follow this link to sign up: ${customInviteLink}  Thank you!`;

    // const body = `Hi! ${(this.props.oauthUser && this.props.oauthUser.commonName) ? this.props.oauthUser.commonName : "Your friend"} would like to invite you to join Mercata. Please follow this link to sign up: <a href="${customInviteLink}">${customInviteLink}</a> Thank you!`;
    textField.innerText = body;
    document.body.appendChild(textField);
    textField.select();
    document.execCommand('copy');
    textField.remove();
  };

  render() {
    const { isModalOpen } = this.state;
    const customInviteLink = "https://bit.ly/MercataSignUp";
    const subject = "Invitation to join Mercata";
    const body = `Hi! ${(this.props.oauthUser && this.props.oauthUser.commonName) ? this.props.oauthUser.commonName : "________"} would like to invite you to join Mercata. Please follow this link to sign up: ${customInviteLink} Thank you!`;

    
    return (
      <nav className="pt-navbar pt-dark smd-menu-bar" >
        <div className="pt-navbar-group pt-align-left">
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
        {/* <div className="pt-navbar-group pt-align-left">
          <div className="pt-navbar-heading">STRATO Management Dashboard</div>
        </div> */}
        <div className="pt-navbar-group pt-align-right">
          <small className="pt-text-muted">STRATO {env.STRATO_VERSION}</small>
          {this.afterLoggedIn()}
        </div>
        {isModalOpen && (
          <div className="pt-dialog-backdrop">
            <div className="pt-dialog">
              <div className="pt-dialog-header">
                <h5 className="pt-dialog-title">Invitation to Join Mercata</h5>
                <button className="pt-dialog-close-button pt-icon-small-cross" onClick={this.closeModal}></button>
              </div>
              <div className="pt-dialog-body">
                <textarea id="inviteText" rows="5" cols="40" style={{ backgroundColor: '#154c79', border: '1px solid #ccc' }}>{body}</textarea>
                {/* <pre style={{ backgroundColor: '#154c79', border: '1px solid #ccc' }}>{body}</pre> */}
              </div>
              <div className="pt-dialog-footer">
                <div className="pt-dialog-footer-actions">
                  <button className="pt-button pt-minimal" onClick={this.closeModal}>Cancel</button>
                  <button className="pt-button pt-intent-primary" onClick={this.copyTextToClipboard}>Copy Text</button>
                  <button className="pt-button pt-intent-primary" onClick={this.sendInvite}>Send Email</button>
                </div>
              </div>
            </div>
          </div>
        )}
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

