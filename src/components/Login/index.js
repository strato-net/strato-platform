import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { login, openLoginOverlay, closeLoginOverlay, resetError } from '../User/user.actions';
import { Dialog, Tabs2, Tab2 } from '@blueprintjs/core';
import './Login.css';
import { launchApp, resetSelectedApp } from '../Applications/applications.actions';
import { toasts } from "../Toasts";
import ExistingUser from './components/ExistingUser';
import FirstTimeUser from './components/FirstTimeUser';

class Login extends Component {

  constructor() {
    super();
    this.state = {
      errors: null,
      navbarTabId: "existingUser",
    };
    this.handleNavbarTabChange = this.handleNavbarTabChange.bind(this);
  }

  componentWillReceiveProps(newProps) {
    if (newProps.isLoggedIn && newProps.selectedApp) {
      newProps.launchApp(newProps.selectedApp.address, newProps.selectedApp.url)
      newProps.resetSelectedApp();
    }

    if (newProps.serverError) {
      toasts.show({ message: newProps.serverError });
      this.props.resetError();
    }
  }

  handleNavbarTabChange(navbarTabId) {
    this.setState({ navbarTabId });
  }

  render() {
    return (
      <div className="smd-pad-16">
        <form>
          <Dialog
            iconName="inbox"
            isOpen={this.props.isOpen}
            onClose={() => {
              this.setState({ errors: null })
              this.props.resetSelectedApp()
              this.props.closeLoginOverlay()
            }}
            title="Login"
            className="pt-dark"
          >
            <div className="pt-dialog-header login-tabs-header">
              <Tabs2
                animate
                className="login-tabs"
                onChange={this.handleNavbarTabChange}
                selectedTabId={this.state.navbarTabId}
              >
                <Tab2 id="existingUser" title="Existing User" />
                <Tab2 id="firstTimeUser" title="First-time User" />
              </Tabs2>
            </div>
            {this.state.navbarTabId === "existingUser"
              ? <ExistingUser closeLoginOverlay={this.props.closeLoginOverlay} />
              : <FirstTimeUser closeLoginOverlay={this.props.closeLoginOverlay} />}
          </Dialog>
        </form>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    isLoggedIn: state.user.isLoggedIn,
    from: state.user.from,
    isOpen: state.user.isOpen,
    selectedApp: state.applications.selectedApp,
    serverError: state.user.error,
  };
}

const connected = connect(
  mapStateToProps,
  {
    login,
    openLoginOverlay,
    closeLoginOverlay,
    launchApp,
    resetSelectedApp,
    resetError
  }
)(Login);

export default withRouter(connected);
