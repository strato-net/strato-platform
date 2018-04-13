import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { login, openLoginOverlay, closeLoginOverlay, resetError } from '../User/user.actions';
import { Dialog } from '@blueprintjs/core';
import './Login.css';
import { launchApp, resetSelectedApp } from '../Applications/applications.actions';
import { toasts } from "../Toasts";
import LoginForm from './components/LoginForm';

class Login extends Component {

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

  render() {
    return (
      <div className="smd-pad-16">
        <form>
          <Dialog
            iconName="inbox"
            isOpen={this.props.isOpen}
            onClose={() => {
              this.props.resetSelectedApp()
              this.props.closeLoginOverlay()
            }}
            title="Login"
            className="pt-dark"
          >
            <LoginForm closeLoginOverlay={this.props.closeLoginOverlay} />
          </Dialog>
        </form>
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    isLoggedIn: state.user.isLoggedIn,
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
