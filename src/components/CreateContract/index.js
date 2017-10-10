import React, {Component} from 'react';
import {
  contractOpenModal,
  contractCloseModal,
  createContract,
  compileContract,
  contractFormChange,
  usernameChange,
  contractNameChange
} from './createContract.actions';
import {fetchAccounts} from '../Accounts/accounts.actions';
import {fetchContracts} from '../Contracts/contracts.actions';
import {Button, Dialog} from '@blueprintjs/core';
import Dropzone from 'react-dropzone'
import {Field, reduxForm, formValueSelector} from 'redux-form';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';

import './CreateContract.css';

// TODO: use solc instead of extabi for compile

class CreateContract extends Component {

  onDrop = (acceptedFiles, rejectedFiles) => {
    this.handleFileUpload(acceptedFiles);
  }
  
  renderDropzoneInput = (field) => {
    const files = field.input.value;
    return (
      <div className="dropzoneContainer text-center">
        <Dropzone
          className={files.length > 0 && files[0].name.includes('.sol') ? "dropzoneActive" : "dropzone"}
          activeClassName="dropzoneActive"
          rejectClassName="dropzoneRejected"
          name={field.name}
          onDrop={(filesToUpload, e) => {this.onDrop(filesToUpload)}}
        >
          {({isDragActive, isDragReject, acceptedFiles}) => {
              if (isDragActive) {
                return <p className="pt-intent-success">Drop to Upload!</p>;
              }
              if (isDragReject) {
                return <p className="pt-intent-warning">Invalid file!</p>;
              }
              else
                return <p className="pt-intent-success">{acceptedFiles.length > 0 ? acceptedFiles[0].name : 'Drop a file here, or click to select files to upload.'}</p>
          }}
        </Dropzone>
        {field.meta.touched &&
        field.meta.error &&
        <span className="error">{field.meta.error}</span>}
      </div>
    );
  };

  handleUsernameChange = (e) => {
    this.props.usernameChange(e.target.value);
  };

  handleContractNameChange = (e) => {
    this.props.contractNameChange(
      e.target.value
    );
  }

  handleFileUpload = (files) => {
    const contract = files[0];
    if (contract && (!contract.name || !contract.name.includes('.sol'))) {
      //TODO: Toaster message for rejected upload
      return;
    }
    let reader = new FileReader();
    const self = this;
    reader.onload = function (event) {
      const fileContents = event.target.result;//.replace(/\r?\n|\r/g, " ");
      mixpanelWrapper.track("create_contract_file_upload");
      self.props.contractFormChange(
        fileContents
      );
      self.props.compileContract(
        contract.name.substring(0, contract.name.indexOf('.')),
        fileContents,
        self.props.searchable
      );
    };
    reader.readAsText(contract);
  };

  handleContractSearchabilityChange = (e) => {
    if (this.props.contract.length) {
      this.props.compileContract(
        this.props.contractName,
        this.props.contract,
        this.props.searchable
      );
    }
  };

  submit = (values) => {
    if (!this.props.createDisabled) {

      const args = {};
      const abi = this.props.abi.src;
      Object.values(abi).forEach(val => {
        if (val.constr !== undefined) {
          return Object.getOwnPropertyNames(val.constr).forEach((arg) => {
            if (values[arg] !== undefined)
              args[arg] = values[arg];
          })
        }
      });

      const payload = {
        contract: this.props.contractName,
        username: values.username,
        address: values.address,
        password: values.password,
        searchable: values.searchable,
        fileText: this.props.contract,
        arguments: args,
      };


      mixpanelWrapper.track('create_contract_submit_click_successful');
      this.props.createContract(payload);
      this.props.reset();
    } else {
      mixpanelWrapper.track('create_contract_submit_click_failure');
    }
  };

  componentDidMount() {
    mixpanelWrapper.track("create_contract_loaded");
    this.props.reset();
    this.props.fetchAccounts();
  }

  compilation() {
    const src = this.props.abi === undefined ? undefined : this.props.abi.src;
    
    if (src === undefined) {
      return (<tr>
        <td colSpan={3}>
          <div className="text-center">Upload Contract</div>
        </td>
      </tr>);
    } else {
      let contract = src[this.props.contractName];
      if (contract && contract['constr'] !== undefined) {
        return Object.getOwnPropertyNames(contract['constr']).map((arg, i) => {
          return (
            <tr key={'arg' + i}>
              <td>{arg}</td>
              <td>{contract.constr[arg].type}</td>
              <td>
                <Field
                  id="input-b"
                  className="pt-input"
                  component="input"
                  name={arg}
                  title="Enter value"
                  type="text"
                  dir="auto"
                  required
                />
              </td>
            </tr>
          );
        });
      } else {
        return (<tr>
          <td colSpan={3}>
            <div className="text-center">No Data</div>
          </td>
        </tr>)
      }
    }
  }

  render() {
    const {handleSubmit, pristine, submitting} = this.props;
    const users = Object.getOwnPropertyNames(this.props.accounts);
    const contracts = this.props.abi && this.props.abi.src && Object.keys(this.props.abi.src);
    const userAddresses = this.props.accounts && this.props.username ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.username])
      : null;

    return (
      <div className="smd-pad-16">
        <Button onClick={() => {
          mixpanelWrapper.track("create_contract_open_click");
          this.props.contractOpenModal()
        }} className="pt-intent-primary pt-icon-add"
                text="Create Contract" id="tour-create-contract-button"/>
        <form>
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
                    <Field
                      className="pt-input"
                      component="select"
                      name="username"
                      onChange={this.handleUsernameChange}
                      required
                    >
                      <option />
                      {
                        users.map((user, i) => {
                          return (
                            <option key={'user' + i} value={user}>{user}</option>
                          )
                        })
                      }
                    </Field>
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
                    <Field
                      className="pt-input"
                      component="select"
                      name="address"
                      required
                    >
                      <option />
                      {
                        userAddresses ?
                          userAddresses.map((address, i) => {
                            return (
                              <option key={address} value={address}>{address}</option>
                            )
                          })
                          : ''
                      }
                    </Field>
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
                  <Field
                    id="input-b"
                    className="form-width pt-input"
                    placeholder="Password"
                    name="password"
                    type="password"
                    component="input"
                    dir="auto"
                    title="Password"
                    required
                  />
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3">
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <label className="pt-control pt-checkbox">
                    <Field
                      id="input-b"
                      className="form-width"
                      name="searchable"
                      type="checkbox"
                      component="input"
                      dir="auto"
                      title="Searchable"
                      onClick={this.handleContractSearchabilityChange}
                      required
                    />
                  <span className="pt-control-indicator"></span>
                    Searchable
                </label>
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Source file
                  </label>
                </div>
                <div className="col-sm-12 smd-pad-4">
                  <Field
                    id="input-b"
                    className="form-width pt-input"
                    name="contract"
                    component={this.renderDropzoneInput}
                    dir="auto"
                    title="Contract Source"
                    required
                  />
                </div>
              </div>
              {contracts && <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Contracts
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <div className="pt-select">
                    <Field
                        className="pt-select"
                        component="select"
                        name="contractName"
                        onChange={this.handleContractNameChange}
                      >
                        {
                          contracts.map((value, index) => {
                            return (
                              <option key={value} value={value}>{value}</option>
                            )
                          })
                        }
                      </Field>
                    </div>
                </div> 
              </div>}
              <div className="row">
                <div className="col-sm-12">
                  <label className="pt-label">
                    Compilation
                  </label>
                </div>
              </div>
              <div className="row">
                <div className="col-sm-12 smd-scrollable">
                  <table className="pt-table pt-condensed pt-striped smd-full-width">
                    <thead>
                    <tr>
                      <th>Arg</th>
                      <th>Type</th>
                      <th>Value</th>
                    </tr>
                    </thead>
                    <tbody>
                    {this.compilation()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button text="Cancel" onClick={() => {
                  mixpanelWrapper.track("create_contract_cancel");
                  this.props.contractCloseModal()
                }}/>
                <Button
                  className={this.props.createDisabled ? "pt-disabled" : "pt-intent-primary"}
                  onClick={handleSubmit(this.submit)}
                  disabled={pristine || submitting}
                  text="Create Contract"
                />

              </div>
            </div>
          </Dialog>
        </form>
      </div>
    );
  }
}

const validate = (values) => {
  const errors = {};

  // const abi = CreateContract.props.abi.src;
  //
  // Object.values(abi).forEach(val => {
  //   if (val.constr !== undefined) {
  //     return Object.getOwnPropertyNames(val.constr).map((arg) => {
  //       if (values[arg] === undefined)
  //         errors[arg] = arg + " Required";
  //     })
  //   }
  // });

  Object.getOwnPropertyNames(values).forEach((val) => {
    if (values[val] === '' || values[val] === undefined) {
      errors[val] = val + " Required";
    }
  });
  return errors
};

const selector = formValueSelector('create-contract');

function mapStateToProps(state) {
  return {
    isOpen: state.createContract.isOpen,
    response: state.createContract.response,
    abi: state.createContract.abi,
    createDisabled: state.createContract.createDisabled,
    contractName: state.createContract.contractName,
    contract: state.createContract.contract,
    accounts: state.accounts.accounts,
    username: state.createContract.username,
    searchable: selector(state, 'searchable')
  };
}

const formed = reduxForm({form: 'create-contract', validate})(CreateContract);
const connected = connect(mapStateToProps, {
  contractOpenModal,
  contractCloseModal,
  createContract,
  compileContract,
  contractFormChange,
  fetchContracts,
  fetchAccounts,
  usernameChange,
  contractNameChange
})(formed);

export default withRouter(connected);
