import React, { Component } from 'react';
import { Button, Dialog } from '@blueprintjs/core';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import { Field, reduxForm, formValueSelector } from 'redux-form';
import { fetchAccounts, fetchUserAddresses } from '../../../Accounts/accounts.actions';
import {
  methodCall,
  methodCallFetchArgs,
  methodCallOpenModal,
  methodCallCloseModal
} from './contractMethodCall.actions';
import './contractMethodCall.css';
import ValueInput from "../../../ValueInput";
import { fetchChainIds, getLabelIds } from '../../../Chains/chains.actions';
import { isOauthEnabled } from '../../../../lib/checkMode';

class ContractMethodCall extends Component {

  handleOpenModal = () => {
    mixpanelWrapper.track("method_call_button_click");
    this.props.methodCallOpenModal(this.props.lookup);
    const address = this.props.fromCirrus && this.props.fromBloc === undefined ? this.props.contractName : this.props.contractAddress
    this.props.methodCallFetchArgs(
      this.props.contractName,
      address,
      this.props.symbolName,
      this.props.lookup,
      this.props.chainId
    );
    !isOauthEnabled() && this.props.fetchAccounts(false, false);
  }

  handleCloseModal = (e) => {
    e.stopPropagation();
    e.preventDefault();
    this.props.reset();
    mixpanelWrapper.track("method_call_cancel");
    this.props.methodCallCloseModal(this.props.lookup);
  }

  submit = (values) => {
    const payload = {
      contractName: this.props.contractName,
      contractAddress: this.props.contractAddress,
      methodName: this.props.symbolName,
      username: values.modalUsername,
      userAddress: values.modalAddress,
      password: isOauthEnabled() ? '' : values.modalPassword,
      value: values.modalValue,
      args: this.props.modal.args ? Object.getOwnPropertyNames(this.props.modal.args)
        .reduce((args, arg) => {
          args[arg] = values[arg];
          return args;
        }, {}) : {},
      chainId: values.chainId
    }
    mixpanelWrapper.track("method_call_submit");
    this.props.methodCall(this.props.lookup, payload);
  }

  handleUsernameChange = (e) => {
    this.props.fetchUserAddresses(e.target.value, false)
  }

  renderUsername = (isModeOauth) => {
    const users = Object.getOwnPropertyNames(this.props.accounts);
    return (<div className={isModeOauth ? "" : "pt-select"}>
      <Field
        className="pt-input"
        name="modalUsername"
        component="select"
        onChange={this.handleUsernameChange}
        disabled={isModeOauth}
        required
      >
        <option value={isModeOauth ? this.props.oAuthUser.username : null}>
          {isModeOauth && this.props.oAuthUser.username}
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
  }

  renderAddress = (isModeOauth) => {
    const userAddresses = Object.keys(this.props.accounts).length && this.props.modalUsername ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.modalUsername])
      : [];
    return (<div className={isModeOauth ? "" : "pt-select"}>
      <Field
        className="pt-input"
        component="select"
        name="modalAddress"
        disabled={isModeOauth}
        required
      >
        <option value={isModeOauth ? this.props.oAuthUser.address : null}>
          {isModeOauth && this.props.oAuthUser.address}
        </option>
        {
          userAddresses.map((address, i) => {
            return (
              <option key={address} value={address}>{address}</option>
            )
          })
        }
      </Field>
    </div>)
  }

  renderChainFields() {
    const chainLabel = Object.getOwnPropertyNames(this.props.chainLabel);

    if (chainLabel.length) {
      return (
        <div>
          <div className="row">
            <div className="col-sm-3 text-right">
              <label className="pt-label label-margin">
                Chain
              </label>
            </div>
            <div className="col-sm-9">
              <div className="pt-select">
                <Field
                  className="pt-input"
                  component="select"
                  name="chainLabel"
                  onChange={
                    (e) => this.props.getLabelIds(e.target.value)
                  }
                  required
                >
                  <option />
                  {
                    chainLabel.map((label, i) => {
                      return (
                        <option key={label + i} value={label}>{label}</option>
                      )
                    })
                  }
                </Field>
              </div>
            </div>
          </div>
          <div className="row">
            <div className="col-sm-3 text-right">
              <label className="pt-label label-margin">
                Chain Ids
              </label>
            </div>
            <div className="col-sm-9">
              <div className="pt-select smd-max-width">
                <Field
                  className="pt-input smd-max-width"
                  component="select"
                  name="chainId"
                  required
                >
                  <option />
                  {
                    Object.getOwnPropertyNames(this.props.chainLabelIds).map((id, i) => {
                      return (
                        <option key={id + i} value={id}>{id}</option>
                      )
                    })
                  }
                </Field>
              </div>
            </div>
          </div>
        </div>
      )
    }
  }

  render() {
    const params = [];
    const handleSubmit = this.props.handleSubmit;
    const isModeOauth = isOauthEnabled();

    if (this.props.modal.args && Object.getOwnPropertyNames(this.props.modal.args).length > 0) {
      const args = Object.getOwnPropertyNames(this.props.modal.args);
      const self = this;
      args.forEach(function (arg, i) {
        params.push(
          <tr key={self.props.symbolName + '-args-' + i}>
            <td style={{ paddingTop: '10px' }}>{arg}</td>
            <td>
              <Field
                name={arg}
                component="input"
                type="text"
                placeholder={self.props.modal.args[arg].type}
                className="pt-input"
                required
              />
            </td>
          </tr>
        );
      });
    }
    else {
      params.push(
        <tr key={this.props.symbolName + '-params-no-rows'}>
          <td className="text-center" colSpan={3}><i>This method has no params</i></td>
        </tr>
      );
    }

    return (
      <div>
        <Button
          className="pt-minimal pt-small pt-intent-primary"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            this.handleOpenModal();
            this.props.fetchChainIds();
          }}
        >
          Call Method
        </Button>
        <form>
          <Dialog
            iconName="exchange"
            isOpen={this.props.modal.isOpen}
            onClose={this.handleCloseModal}
            title={"Call '" + this.props.symbolName + "' on " + this.props.contractName}
            className="pt-dark"
          >
            <div className="pt-dialog-body">
              <div className="row">
                <div className="col-sm-12">
                  <h5>Address: {this.props.contractAddress}</h5>
                </div>
              </div>
              {this.renderChainFields()}
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label label-margin">
                    Username
                  </label>
                </div>
                <div className="col-sm-9">
                  {this.renderUsername(isModeOauth)}
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label label-margin">
                    Address
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  {this.renderAddress(isModeOauth)}
                </div>
              </div>
              {!isModeOauth && <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label label-margin">
                    Password
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <Field
                    name="modalPassword"
                    className="pt-input"
                    placeholder="Password"
                    component="input"
                    type="password"
                    required
                  />
                </div>
              </div>}
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label label-margin">
                    Value
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <Field
                    name="modalValue"
                    component={ValueInput}
                  />
                </div>
              </div>
              <div className="row">
                <div className="col-sm-12">
                  <h5>Parameters</h5>
                </div>
              </div>
              <div className="row">
                <div className="col-sm-12 smd-scrollable">
                  <table className="pt-table pt-condensed pt-striped smd-full-width">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {params}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="row">
                <div className="col-sm-12">
                  <hr />
                  <h5>Results</h5>
                  <pre className="smd-scrollable">
                    {this.props.modal.result} <br />
                  </pre>
                </div>
              </div>
            </div>
            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button text="Cancel" onClick={this.handleCloseModal} />
                <button
                  disabled={this.props.pristine || this.props.submitting || !this.props.valid}
                  className="pt-button pt-intent-primary"
                  type="button"
                  onClick={handleSubmit(this.submit)}
                >
                  Call Method
                </button>
              </div>
            </div>
          </Dialog>
        </form>
      </div>
    );
  }
}

export const validate = (values) => {
  const errors = {};

  Object.getOwnPropertyNames(values).forEach((val) => {
    if (values[val] === '' || values[val] === undefined) {
      errors[val] = val + " Required";
    }
  });
  return errors
};

const selector = formValueSelector('contract-method-call');

export function mapStateToProps(state, ownProps) {
  return {
    modal: state.methodCall.modals
      && state.methodCall.modals[ownProps.lookup] ?
      state.methodCall.modals[ownProps.lookup] : {},
    accounts: state.accounts.accounts,
    currentUser: state.user.currentUser,
    modalUsername: selector(state, 'modalUsername'),
    chainLabel: state.chains.listChain,
    chainLabelIds: state.chains.listLabelIds,
    oAuthUser: state.user.oauthUser
  };
}


const formed = reduxForm({ form: 'contract-method-call', validate })(ContractMethodCall);
const connected = connect(
  mapStateToProps,
  {
    methodCallFetchArgs,
    methodCallOpenModal,
    methodCallCloseModal,
    fetchAccounts,
    fetchUserAddresses,
    methodCall,
    fetchChainIds,
    getLabelIds
  }
)(formed);
const routed = withRouter(connected);

export default routed;
