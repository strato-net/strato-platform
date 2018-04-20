import React, { Component } from 'react';
import { closeTokenRequestOverlay } from './tokenRequest.actions';
import { Dialog } from '@blueprintjs/core';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import Faucet from '../Faucet';
import './tokenRequest.css';
import { faucetRequest } from '../Accounts/accounts.actions';

class TokenRequest extends Component {
  render() {
    return (
      <Dialog
        isOpen={this.props.isTokenOpen}
        onClose={this.props.closeTokenRequestOverlay}
        title="Request Tokens"
        className="pt-dark token-request-dialog"
      >
        <Faucet 
          currentUser={this.props.currentUser} 
          faucetRequest={this.props.faucetRequest}
          accountAddress={this.props.currentUser.accountAddress} />
      </Dialog>
    );
  }
}

export function mapStateToProps(state) {
  return {
    isTokenOpen: state.tokenRequest.isTokenOpen,
    currentUser: state.user.currentUser,
  };
}

const connected = connect(mapStateToProps, {
  closeTokenRequestOverlay,
  faucetRequest
})(TokenRequest);

export default withRouter(connected);
