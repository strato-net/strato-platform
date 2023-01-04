import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { closeAttestModal, attestDocument, resetError, changeUsername } from './attest.actions';
import { Dialog, Button, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import mixpanelWrapper from '../../../lib/mixpanelWrapper';
import validate from './validate';
import { isOauthEnabled } from '../../../lib/checkMode';
import { toasts } from '../../Toasts';
import { fetchUserAddresses } from '../../Accounts/accounts.actions';

import './attest.css';

class Attest extends Component {

  constructor(props) {
    super(props);
    this.state = { errors: null }
  }

  componentWillReceiveProps(nextProps) {

    if (nextProps.attestError) {
      toasts.show({ message: nextProps.attestError });
      this.props.resetError();
    }
  }

  submit = (values) => {
    let errors = validate(values);
    this.setState({ errors });

    if (!Object.values(errors).length) {
      this.props.attestDocument(values);
      this.props.reset();
    }
  }

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  handleUsernameChange = (e) => {
    this.props.changeUsername(e.target.value);
    this.props.fetchUserAddresses(e.target.value, true);
  };

  renderUsername = (isModeOauth) => {
    const users = Object.getOwnPropertyNames(this.props.accounts);
    return (<div className={isModeOauth ? "" : "pt-select"}>
      <Field
        className="pt-input"
        component="select"
        name="username"
        onChange={this.handleUsernameChange}
        required
        disabled={isModeOauth}
      >
        <option value={isModeOauth ? this.props.initialValues.username : null}>
          {isModeOauth && this.props.initialValues.username}
        </option>
        {
          users.map((user, i) => {
            return (
              <option key={'user' + i} value={user}>{user}</option>
            )
          })
        }
      </Field>
    </div>)
  };

  renderAuth = () => {
    const isModeOauth = isOauthEnabled();

    return <div>
      <div className="row">
        <div className="col-sm-3 text-right">
          <label className="pt-label smd-pad-4">
            Username
          </label>
        </div>
        <div className="col-sm-9 smd-pad-4">
          {this.renderUsername(isModeOauth)}
          <br /><span className="error-text">{this.errorMessageFor('username')}</span>
        </div>
      </div>
      <div className="row">
        <div className="col-sm-3 text-right">
          <label className="pt-label smd-pad-4">
            Address
          </label>
        </div>
        <div className="col-sm-9 smd-pad-4">
          {this.renderAddress(isModeOauth)}
          <br /> <span className="error-text">{this.errorMessageFor('address')}</span>
        </div>
      </div>
      {!isModeOauth && <div className="row">
        <div className="col-sm-3 text-right">
          <label className="pt-label smd-pad-4">
            Password
          </label>
        </div>
        <div className="col-sm-9 smd-pad-4">
          <Field
            name="password"
            component="input"
            type="password"
            placeholder="Password"
            className="pt-input form-width"
            tabIndex="3"
            required
          /> <br />
          <span className="error-text">{this.errorMessageFor('password')}</span>
        </div>
      </div>}
    </div>
  }

  renderAddress = (isModeOauth) => {
    const userAddresses = this.props.accounts && this.props.username ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.username])
      : [];
    return (<div className={isModeOauth ? "" : "pt-select"}>
      <Field
        className="pt-input"
        component="select"
        name="address"
        required
        disabled={isModeOauth}
      >
        <option value={isModeOauth ? this.props.initialValues.address : null}>
          {isModeOauth && this.props.initialValues.address}
        </option>
        {
          userAddresses.map((address, i) => {
            return (
              <option key={address} value={address}>{address}</option>
            )
          })
        }
      </Field>
    </div>);
  };

  renderAttestForm() {
    return (
      <div className="pt-dialog-body upload-form">

        {this.renderAuth()}

        <div className="row">
          <div className="col-sm-3 text-right">
            <label className="pt-label smd-pad-4">
              Contract Address
            </label>
          </div>
          <div className="col-sm-9 smd-pad-4">
            <Field
              name="contractAddress"
              component="input"
              type="text"
              placeholder="Contract Address"
              className="pt-input form-width"
              tabIndex="4"
              required
            />
            <br /><span className="error-text">{this.errorMessageFor('contractAddress')}</span>
          </div>
        </div>

        <div className="pt-dialog-footer">
          <div className="pt-dialog-footer-actions button-center smd-margin-8">
            <Button
              intent={Intent.PRIMARY}
              onClick={this.props.handleSubmit(this.submit)}
              disabled={this.props.isLoading}
              text="Attest"
            />
          </div>
        </div>
      </div>
    );
  }

  attestDetails(data) {

    const signers = data.signers.map((value, key) => {
      return (
        <li key={key}> {value} </li>
      )
    })

    return (
      <div>
        <div className="pt-dialog-body attest-result">

          <div className="row content-margin signatures">
            <div className="col-sm-12">
              <center>
                <h4><label> Signatures </label></h4>
                <ul>{signers}</ul>
              </center>
            </div>
          </div>

        </div>

        <div className="pt-dialog-footer">
          <div className="pt-dialog-footer-actions button-center">
            <Button
              intent={Intent.PRIMARY}
              onClick={() => {
                this.props.reset();
                this.props.closeAttestModal();
              }}
              text="Close"
            />
          </div>
        </div>
      </div>
    )
  }

  render() {
    let result = this.props.attestResult;

    return (
      <div>
        <form>
          <Dialog
            isOpen={this.props.isOpen}
            onClose={() => {
              mixpanelWrapper.track('close_attest_modal');
              this.props.reset();
              this.props.closeAttestModal();
            }}
            iconName={result ? 'saved' : 'pt-icon-tick'}
            title={result ? 'Successfully Signed' : 'Attest'}
            className="pt-dark"
          >
            {result ? this.attestDetails(result) : this.renderAttestForm()}
          </Dialog>
        </form>
      </div>
    )
  }
}

export function mapStateToProps(state) {
  return {
    isOpen: state.attest.isOpen,
    attestError: state.attest.error,
    attestResult: state.attest.attestDocument,
    username: state.attest.username,
    isLoading: state.attest.isLoading,
    accounts: state.accounts.accounts,
    initialValues: {
      username: state.user.oauthUser ? state.user.oauthUser.commonName : '',
      address: state.user.oauthUser ? state.user.oauthUser.address : ''
    }
  };
}

const formed = reduxForm({ form: 'attest-document' })(Attest);
const connected = connect(
  mapStateToProps,
  {
    closeAttestModal,
    attestDocument,
    changeUsername,
    fetchUserAddresses,
    resetError
  }
)(formed);

export default withRouter(connected);
