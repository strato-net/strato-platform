import React, {Component} from 'react';
import { Button, Dialog } from '@blueprintjs/core';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import { Field, reduxForm, formValueSelector } from 'redux-form';
import { fetchAccounts } from '../../../Accounts/accounts.actions';
import {
  methodCall,
  methodCallFetchArgs,
  methodCallOpenModal,
  methodCallCloseModal
} from './contractMethodCall.actions';

import './contractMethodCall.css';

class ContractMethodCall extends Component {

  handleOpenModal = (e) => {
    e.stopPropagation();
    e.preventDefault();
    mixpanelWrapper.track("method_call_button_click");
    this.props.methodCallOpenModal(this.props.lookup);
    this.props.methodCallFetchArgs(
      this.props.contractName,
      this.props.contractAddress,
      this.props.symbolName,
      this.props.lookup
    );
    this.props.fetchAccounts();
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
      password: values.modalPassword,
      value: values.modalValue,
      args: Object.getOwnPropertyNames(this.props.modal.args)
        .reduce((args, arg) => {
          args[arg] = values[arg];
          return args;
        }, {})
    }
    mixpanelWrapper.track("method_call_submit");
    this.props.methodCall(this.props.lookup, payload);
  }

  render() {
    const params = [];
    const handleSubmit = this.props.handleSubmit;

    const users = Object.getOwnPropertyNames(this.props.accounts);

    const userAddresses = this.props.accounts && this.props.modalUsername ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.modalUsername])
      : null;

    if(this.props.modal.args && Object.getOwnPropertyNames(this.props.modal.args).length > 0) {
      const args = Object.getOwnPropertyNames(this.props.modal.args);
      const self = this;
      args.forEach(function(arg,i){
        params.push(
          <tr key={self.props.symbolName + '-args-' + i}>
            <td style={{paddingTop: '10px'}}>{arg}</td>
            <td>
              <Field
                name={arg}
                component="input"
                type="text"
                placeholder={self.props.modal.args[arg].type}
                className="pt-input"
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
          onClick={this.handleOpenModal}
          disabled={this.props.fromCirrus}
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
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label" style={{marginTop: '5px'}}>
                    Username
                  </label>
                </div>
                <div className="col-sm-9">
                  <div className="pt-select">
                    <Field
                      className="pt-input"
                      name="modalUsername"
                      component="select"
                      required
                    >
                      <option />
                      {
                        users.map((user,i) => { return (
                          <option key={'user' + i} value={user}>{user}</option>
                        )})
                      }
                    </Field>
                  </div>
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label" style={{marginTop: '9px'}}>
                    Address
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <div className="pt-select">
                    <Field
                      className="pt-input"
                      component="select"
                      name="modalAddress"
                      required
                    >
                      <option />
                      {
                        userAddresses ?
                          userAddresses.map((address,i) => { return (
                            <option key={address} value={address}>{address}</option>
                          )})
                          : ''
                      }
                    </Field>
                  </div>
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label" style={{marginTop: '9px'}}>
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
              </div>
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label" style={{marginTop: '9px'}}>
                    Value
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <Field
                    name="modalValue"
                    className="pt-input"
                    placeholder="Ether"
                    component="input"
                    type="text"
                    required
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
                    {this.props.modal.result} <br/>
                  </pre>
                </div>
              </div>
            </div>
            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button text="Cancel" onClick={this.handleCloseModal} />
                <button
                  disabled={this.props.pristine || this.props.submitting}
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

const selector = formValueSelector('contract-method-call');

function mapStateToProps(state, ownProps) {
  return {
    modal: state.methodCall.modals
      && state.methodCall.modals[ownProps.lookup] ?
      state.methodCall.modals[ownProps.lookup] : {},
    accounts: state.accounts.accounts,
    modalUsername: selector(state, 'modalUsername')
  };
}


const formed = reduxForm({ form: 'contract-method-call' })(ContractMethodCall);
const connected = connect(
  mapStateToProps,
  {
    methodCallFetchArgs,
    methodCallOpenModal,
    methodCallCloseModal,
    fetchAccounts,
    methodCall,
  }
)(formed);
const routed = withRouter(connected);

export default routed;
