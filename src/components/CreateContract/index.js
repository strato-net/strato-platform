import React, {Component} from 'react';
import {
  contractOpenModal,
  contractCloseModal,
  createContract,
  compileContract,
  contractFormChange,
  usernameChange
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
        contract.name,
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
        contract: this.props.filename.substring(0, this.props.filename.indexOf('.')),
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

  render() {
    const {handleSubmit, pristine, submitting} = this.props;
    const users = Object.getOwnPropertyNames(this.props.accounts);

    const userAddresses = this.props.accounts && this.props.username ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.username])
      : null;

    const src = this.props.abi === undefined ? undefined : this.props.abi.src;

    let args = src === undefined ?
      <tr>
        <td colSpan={3}>
          <div className="text-center">Upload Contract</div>
        </td>
      </tr> :

      // eslint-disable-next-line
      (Object.values(src).map(val => {
        if (val.constr !== undefined) {
          return Object.getOwnPropertyNames(val.constr).map((arg, i) => {
            return (
              <tr key={'arg' + i}>
                <td>{arg}</td>
                <td>{val.constr[arg].type}</td>
                <td>
                  <Field
                    id="input-b"
                    className="pt-input"
                    component="input"
                    name={arg}
                    title="Enter value"
                    type="text"
                    dir="auto"
                  />
                </td>
              </tr>
            );
          });
        }
      }));

    return (
      <div className="smd-pad-16">
        <Button onClick={() => {
          mixpanelWrapper.track("create_contract_open_click");
          this.props.contractOpenModal()
        }} className="pt-intent-primary pt-icon-add"
                text="Create Contract"/>
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
                  />
                </div>
              </div>
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
                    {args}
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
    filename: state.createContract.filename,
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
  usernameChange
})(formed);

export default withRouter(connected);
