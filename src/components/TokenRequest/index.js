import React, { Component } from 'react';
import { closeTokenRequestOverlay } from './tokenRequest.actions';
import { Dialog } from '@blueprintjs/core';
import { reduxForm } from 'redux-form';
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
          errors={this.props.errors} 
          handleSubmit={this.props.handleSubmit} 
          submitting={this.props.submitting} 
          currentUser={this.props.currentUser} 
          faucetRequest={this.props.faucetRequest}
          accountAddress={this.props.currentUser.accountAddress} />
      </Dialog>
    );
  }
}

export function mapStateToProps(state) {
  let errors = { errors: undefined };

  if (state.form && state.form["tokenRequest"]) {
    errors = { errors: state.form["tokenRequest"].syncErrors }
  }
  return {
    isTokenOpen: state.tokenRequest.isTokenOpen,
    currentUser: state.user.currentUser,
    ...errors
  };
}

export function validate(values) {
  const errors = {};
  if (values.building === undefined && !values.building) {
    errors.building = "Please tell us what are you building";
  }

  return errors;
}

const formed = reduxForm({ form: 'tokenRequest', validate })(TokenRequest);
const connected = connect(mapStateToProps, {
  closeTokenRequestOverlay,
  faucetRequest
})(formed);

export default withRouter(connected);
