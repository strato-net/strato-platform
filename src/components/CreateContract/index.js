import React, {Component} from 'react';
import {
  contractOpenModal,
  contractCloseModal,
  createContract,
  compileContract,
  usernameFormChange,
  passwordFormChange,
  contractFormChange,
  addressFormChange
} from './createContract.actions';
import { fetchAccounts } from '../Accounts/accounts.actions';
import { fetchContracts } from '../Contracts/contracts.actions';
import { Button, Dialog } from '@blueprintjs/core';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';

import './CreateContract.css';

// TODO: use redux-form
// TODO: Remove global variables
// TODO: use solc instead of extabi for compile

let inputs = {};
class CreateContract extends Component {

  handleFileUpload = (e) => {
    const contract = e.target.files[0];
    let reader = new FileReader();
    const self = this;
    reader.onload = function (event) {
      const fileContents = event.target.result.replace(/\r?\n|\r/g, " ");
      self.props.contractFormChange(
        contract.name,
        fileContents
      );
      self.props.compileContract(
        contract.name.substring(0,contract.name.indexOf('.')),
        fileContents
      );
    }
    reader.readAsText(contract);
  }

  handleAddressChange = (e) => {
    this.props.addressFormChange(e.target.value);
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
        contract: this.props.filename.substring(0,this.props.filename.indexOf('.')),
        username: this.props.username,
        address: this.props.address,
        password: this.props.password,
        fileText: this.props.contract,
        arguments: inputs,
      }
      this.props.createContract(payload);
    }
  };

  componentDidMount() {
    this.props.fetchAccounts();
  }

  render() {

    const users = Object.getOwnPropertyNames(this.props.accounts);

    const userAddresses = this.props.accounts && this.props.username ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.username])
      : null;

    const src = this.props.abi === undefined ? undefined : this.props.abi.src;

    let args = src === undefined ?
      <tr>
        <td colSpan={3} className="text-center">
          <i> Upload contract source file to see args </i>
        </td>
      </tr> :

        // eslint-disable-next-line
        (Object.values(src).map(val => {
          if (val.constr !== undefined) {
            return Object.getOwnPropertyNames(val.constr).map((arg,i) => {
              return (
                <tr key={'arg' + i}>
                  <td>{arg}</td>
                  <td>{val.constr[arg].type}</td>
                  <td>
                    <input id="input-b" className="pt-input"
                      title="Enter value"
                      onChange={(e) => {
                        inputs[arg] = e.target.value;
                      }}
                      type="text"
                      dir="auto"
                    />
                  </td>
                </tr>
              );
            });
          }
        }));

    // if(args[0] === undefined) {
    //   args = [];
    //   args.push(<tr key="argsNoArgs">
    //     <td colSpan={3} className="text-center">
    //       <i> Constructor has no arguments </i>
    //     </td>
    //   </tr>);
    // }

    return (
      <div className="smd-pad-16">
        <Button onClick={this.props.contractOpenModal} className="pt-intent-primary pt-icon-add"
                text="Create Contract"/>
        <Dialog
          iconName="inbox"
          isOpen={this.props.isOpen}
          onClose={this.props.contractCloseModal}
          title="Create New Contract"
          className="pt-dark"
        >
          <div className="pt-dialog-body">

            <div className="row">
              <div className="col-sm-3 text-right">
                <label className="pt-label smd-pad-4">
                  Username
                </label>
              </div>
              <div className="col-sm-9 smd-pad-4">
                <div className="pt-select">
                  <select onChange={this.handleUsernameChange}>
                    <option />
                    {
                      users.map((user,i) => { return (
                        <option key={'user' + i} value={user}>{user}</option>
                      )})
                    }
                  </select>
                </div>
              </div>
            </div>
            <div className="row">
              <div className="col-sm-3 text-right">
                <label className="pt-label smd-pad-4">
                  Address
                </label>
              </div>
              <div className="col-sm-9 smd-pad-4">
                <div className="pt-select">
                  <select onChange={this.handleAddressChange}>
                    <option />
                    {
                      userAddresses ?
                        userAddresses.map((address,i) => { return (
                          <option key={address} value={address}>{address}</option>
                        )})
                        : ''
                    }
                  </select>
                </div>
              </div>
            </div>
            <div className="row">
              <div className="col-sm-3 text-right">
                <label className="pt-label smd-pad-4">
                  Password
                </label>
              </div>
              <div className="col-sm-9 smd-pad-4">
                <input
                  id="input-b"
                  className={this.props.password === undefined ? "form-width pt-input pt-intent-danger" : "form-width pt-input"}
                  placeholder="Password"
                  onChange={this.handlePasswordChange}
                  type="password"
                  dir="auto"
                  title="Password"
                />
              </div>
            </div>
            <div className="row">
              <div className="col-sm-3 text-right">
                <label className="pt-label smd-pad-4">
                  Source file
                </label>
              </div>
              <div className="col-sm-9 smd-pad-4">
                <label className="pt-file-upload">
                  <input type="file" onChange={this.handleFileUpload} />
                  <span className="pt-file-upload-input">{this.props.filename}</span>
                </label>
              </div>
            </div>
            <div className="row">
              <div className="col-sm-3 text-right">
                <label className="pt-label smd-pad-4">
                  Compilation
                </label>
              </div>
              <div className="col-sm-9 smd-pad-4">
                <table className="pt-table pt-condensed pt-striped">
                  <thead>
                    <tr>
                      <th>Arg</th>
                      <th>Type</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {args}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="pt-dialog-footer">
            <div className="pt-dialog-footer-actions">
              <Button text="Cancel" onClick={this.props.contractCloseModal}/>
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
    address: state.createContract.address,
    compileSuccess: state.createContract.compileSuccess,
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
  contractOpenModal,
  contractCloseModal,
  createContract,
  compileContract,
  usernameFormChange,
  passwordFormChange,
  contractFormChange,
  addressFormChange,
  fetchContracts,
  fetchAccounts
})(CreateContract));
