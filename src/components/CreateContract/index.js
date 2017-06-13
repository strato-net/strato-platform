import React, {Component} from 'react';
import {
  openOverlay,
  closeOverlay,
  createContract,
  compileContract,
  usernameFormChange,
  passwordFormChange,
  contractFormChange
} from './createContract.actions';
import { fetchAccounts } from '../Accounts/accounts.actions';
import { fetchContracts } from '../Contracts/contracts.actions';
import { Button, Dialog } from '@blueprintjs/core';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';

import './CreateContract.css';

var inputs = {}
class CreateContract extends Component {

  handleFileUpload = (e) => {
    let contract = e.target.files[0];
    let reader = new FileReader();
    const self = this;
    reader.onload = function (event) {
      contract = event.target.result.replace(/\r?\n|\r/g, " ");
      self.props.contractFormChange(contract.name, contract);
      self.props.compileContract(contract);
    }
    reader.readAsText(contract);
  }

  handleUsernameChange = (e) => {
    this.props.usernameFormChange(e.target.value);
  };

  handlePasswordChange = (e) => {
    this.props.passwordFormChange(e.target.value);
  };

  handleSubmit = () => {
    if (!this.props.createDisabled) {
      const payload = {
        username: this.props.username,
        password: this.props.password,
        fileText: this.props.contract,
        arguments: inputs,
      }
      this.props.createContract(payload);
    }
    this.props.fetchContracts();
  };

  componentDidMount() {
    this.props.fetchAccounts();
  }

  render() {
    const users = Object.getOwnPropertyNames(this.props.accounts);
    const userAddresses = this.props.accounts && this.props.username ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.username])
      : null;
    let src = this.props.abi === undefined ? undefined : this.props.abi.src;
    let args = src === undefined ?
      <div className="input">
        <label className="pt-label">
          Waiting for Compliation...
        </label>
      </div> :
      (
        // eslint-disable-next-line
      Object.values(src).map(val => {
          if (val.constr !== undefined) {
            return Object.getOwnPropertyNames(val.constr).map(arg => {
              inputs[arg]= '';
              return (<div className="input">
                <label className="pt-label">
                  {arg + " (" + val.constr[arg].type + ")"}
                </label>
                <div className="pt-form-content">
                  <input id="input-b" className="form-width pt-input" placeholder={arg+" ("+val.constr[arg].type+")"}
                              onChange={(e) => {
                                inputs[arg] = e.target.value;
                              }}
                              type="text" dir="auto"/>
                  <div className="pt-form-helper-text">Enter a {val.constr[arg].type}</div>
                </div>
              </div>);
            });
          }
        }
      )
    );

    return (<div className="smd-pad-16">
        <Button onClick={this.props.openOverlay} className="pt-intent-primary pt-icon-add"
                text="Create Contract"/>
        <Dialog
          iconName="inbox"
          isOpen={this.props.isOpen}
          onClose={this.props.closeOverlay}
          title="Create New Contract"
          className="pt-dark"
        >
          <div className="pt-dialog-body">
            <div className="pt-form-group text-center">
              <label className="pt-label pt-inline">
                Username &nbsp;
                <div className="pt-select">
                  <select onChange={this.handleUsernameChange}>
                    {
                      users.map((user,i) => { return (
                        <option key={'user' + i} value={user}>{user}</option>
                      )})
                    }
                  </select>
                </div>
              </label>
              <label className="pt-label pt-inline">
                Address &nbsp;
                <div className="pt-select">
                  <select>
                    {
                      userAddresses ?
                        userAddresses.map((address,i) => { return (
                          <option key={address} value={address}>{address}</option>
                        )})
                        : ''
                    }
                  </select>
                </div>
              </label>

              <div className="input">
                <label className="pt-label">
                  Password
                </label>
                <div className="pt-form-content">
                  <input id="input-b" className={this.props.password === undefined ? "form-width pt-input pt-intent-danger" : "form-width pt-input"} placeholder="Password"
                              onChange={this.handlePasswordChange}
                              type="text" dir="auto"/>
                  <div className="pt-form-helper-text">Enter your password</div>
                </div>
              </div>

              <div className="input">
                <label style={{"margin": "0.5%"}} className="pt-file-upload">
                  <input type="file" onChange={this.handleFileUpload} className={this.props.filename === undefined ? "pt-intent-danger" : ""}/>
                  <span className="pt-file-upload-input form-width">{this.props.filename === undefined ? 'Upload Contract(.sol)' : this.props.filename}</span>
                </label>
              </div>

              {args}
            </div>
          </div>

          <div className="pt-dialog-footer">
            <div className="pt-dialog-footer-actions">
              <Button text="Cancel" onClick={this.props.closeOverlay}/>
              <Button
                className={this.props.createDisabled ? "pt-disabled" : "pt-intent-primary"}
                onClick={this.handleSubmit}
                text="Create Contract"
              />
            </div>
          </div>
        </Dialog>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    isOpen: state.createContract.isOpen,
    spinning: state.createContract.compileSuccess,
    response: state.createContract.response,
    abi: state.createContract.abi,
    createDisabled: state.createContract.createDisabled,
    filename: state.createContract.filename,
    username: state.createContract.username,
    password: state.createContract.password,
    contract: state.createContract.contract,
    accounts: state.accounts.accounts,
  };
}

export default withRouter(connect(mapStateToProps, {
  openOverlay,
  closeOverlay,
  createContract,
  compileContract,
  usernameFormChange,
  passwordFormChange,
  contractFormChange,
  fetchContracts,
  fetchAccounts
})(CreateContract));
