import React, { Component } from 'react';
import { Button, Dialog, PopoverInteractionKind, Position, AnchorButton, Popover } from '@blueprintjs/core';
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
import HexText from '../../../HexText';

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
    try {
      const parsedArgs = this.props.modal.args ? Object.entries(this.props.modal.args)
        .reduce((args, [arg, info]) => {
          try {
            args[arg] = JSON.parse(values[arg]);
            return args;
          }
          catch (e) {
            console.log(e)
            args[arg] = values[arg];
            return args;
          }
        }, {}) : {}
        const payload = {
          contractName: this.props.contractName,
          contractAddress: this.props.contractAddress,
          methodName: this.props.symbolName,
          username: values.modalUsername,
          userAddress: values.modalAddress,
          password: isOauthEnabled() ? '' : values.modalPassword,
          value: values.modalValue,
          args: parsedArgs,
          chainId: this.props.selectedChain ? this.props.selectedChain : undefined
        }
        mixpanelWrapper.track("method_call_submit");
        this.props.methodCall(this.props.lookup, payload);
      } catch (e) {
        return
      }
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
        <option value={isModeOauth && this.props.userCertificate ? this.props.userCertificate.commonName : "Verification Pending"}>
          {isModeOauth && this.props.userCertificate ? this.props.userCertificate.commonName : "Verification Pending"}
        </option>
        {
          users.map((user, i) => {
            return (
              <option key={'user' + i} value={user.commonName}>{user.commonName}</option>
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
        <option value={isModeOauth && this.props.userCertificate ? this.props.userCertificate.userAddress : "Verification Pending"}>
          {isModeOauth && this.props.userCertificate ? this.props.userCertificate.userAddress : "Verification Pending"}
        </option>
        {
          userAddresses.map((address, i) => {
            return (
              <option key={address.address} value={address.address}>{address.address}</option>
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
                Shard
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
                Shard Ids
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
        <Popover 
          isDisabled={!!this.props.userCertificate}
          interactionKind={PopoverInteractionKind.HOVER}
          position={Position.LEFT}
          content={
            <div className='pt-dark pt-callout smd-pad-8 pt-icon-info-sign pt-intent-warning'>
              <h5 className="pt-callout-title">Verification Required</h5>
                Your identity must be verified before you can do this action.
            </div>
          }
        >
          <AnchorButton
            className="pt-intent-primary pt-icon-send-to-graph"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              this.handleOpenModal();
            }}
            disabled={!this.props.userCertificate}
            text={this.props.symbolName}
          />
        </Popover>
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
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Contract Address
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  {this.props.contractAddress}
                </div>
              </div>
              <div className='row'>
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Shard
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  {this.props.selectedChain ? <HexText value={this.props.selectedChain}/> : "Main Chain"}
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label label-margin">
                    Name
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  {this.renderUsername(isModeOauth)}
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label label-margin">
                    Caller Address
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
              {this.props.modal.isPayable && <div className="row">
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
              </div>}
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
    modalUsername: selector(state, 'modalUsername'),
    chainLabel: state.chains.listChain,
    chainLabelIds: state.chains.listLabelIds,
    oAuthUser: state.user.oauthUser,
    userCertificate: state.user.userCertificate,
    selectedChain: state.chains.selectedChain,
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
