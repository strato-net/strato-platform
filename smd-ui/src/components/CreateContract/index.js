import React, { Component } from 'react';
import {
  contractOpenModal,
  contractCloseModal,
  createContract,
  compileContract,
  contractFormChange,
  usernameChange,
  contractNameChange,
  resetError
} from './createContract.actions';
import { fetchAccounts, fetchUserAddresses } from '../Accounts/accounts.actions';
import { fetchContracts } from '../Contracts/contracts.actions';
import { Button, Dialog } from '@blueprintjs/core';
import Dropzone from 'react-dropzone'
import { Field, reduxForm, formValueSelector } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { required } from '../../lib/reduxFormsValidations'
import { toasts } from "../Toasts";
import { isModePublic } from '../../lib/checkMode';
import { fetchChainIds, getLabelIds } from '../Chains/chains.actions';

// TODO: use solc instead of /contracts/xabi for compile

class CreateContract extends Component {

  renderDropzoneInput = (field) => {
    const touchedAndHasErrors = field.meta.touched && field.meta.error
    return (
      <div className="dropzoneContainer text-center">
        <Dropzone
          className="dropzone"
          name={field.name}
          onDrop={(filesToUpload, e) => this.handleFileDrop(filesToUpload, field)}
        >
          {({ isDragActive, isDragReject, acceptedFiles }) => {
            if (isDragActive) {
              return (<p className="pt-intent-success">Drop to Upload!</p>);
            }
            return (<p className="pt-intent-success">{acceptedFiles.length > 0 ? acceptedFiles[0].name : 'Drop a file here, or click to select files to upload.'}</p>)
          }}
        </Dropzone>
        {touchedAndHasErrors && <span className="error">{field.meta.error}</span>}
      </div>
    );
  };

  handleUsernameChange = (e) => {
    this.props.usernameChange(e.target.value);
    this.props.fetchUserAddresses(e.target.value, true)
  };

  handleContractNameChange = (e) => {
    this.props.sourceFromEditor ?
      this.props.onChangeEditorContractName(e.target.value)
      : this.props.contractNameChange(
        e.target.value
      );
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.isToasts) {
      toasts.show({ message: nextProps.toastsMessage });
      this.props.resetError();
    }
  }

  handleFileDrop = (files, dropZoneField) => {
    this.props.touch('contract');
    dropZoneField.input.onChange(files);
    const contract = files[0];

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

  isValidFileType = (files) => {
    if (!files || !files[0])
      return 'Please add contract source file'
    const contractSource = files[0];
    if (!contractSource.name.includes('.sol'))
      return 'It should be an .sol extention file';
  };

  handleContractSearchabilityChange = (e) => {
    const contractName = this.props.sourceFromEditor ? this.props.contractNameFromEditor : this.props.contractName
    const source = this.props.textFromEditor ? this.props.textFromEditor : this.props.contract
    if (source.length) {
      this.props.compileContract(
        contractName,
        source,
        e.target.checked
      );
    }
  };

  submit = (values) => {
    const args = {};
    const contractname = this.props.sourceFromEditor ? this.props.contractNameFromEditor : this.props.contractName
    const abi = this.props.sourceFromEditor ? this.props.sourceFromEditor : this.props.abi.src;
    Object.values(abi).forEach(val => {
      if (val.constr !== undefined) {
        return Object.getOwnPropertyNames(val.constr).forEach((arg) => {
          if (values[`field${arg}`] !== undefined)
            args[arg] = values[`field${arg}`];
        })
      }
    });
    const fileText = this.props.textFromEditor ? this.props.textFromEditor : this.props.contract

    const payload = {
      contract: contractname,
      username: values.username,
      address: values.address,
      password: values.password,
      searchable: values.searchable,
      fileText: fileText,
      arguments: args,
      chainId: values.chainId
    };

    mixpanelWrapper.track('create_contract_submit_click_successful');
    this.props.createContract(payload);
    this.props.reset();
  };

  renderUsername = (isPublicMode) => {
    const users = Object.getOwnPropertyNames(this.props.accounts);
    return (<div className={isPublicMode ? "" : "pt-select"}>
      <Field
        className="pt-input"
        component="select"
        name="username"
        onChange={this.handleUsernameChange}
        validate={required}
        required
        disabled={isPublicMode}
      >
        <option value={isPublicMode ? this.props.initialValues.username : null}>
          {isPublicMode && this.props.initialValues.username}
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

  renderAddress = (isPublicMode) => {
    const userAddresses = this.props.accounts && this.props.username ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.username])
      : [];
    return (<div className={isPublicMode ? "" : "pt-select"}>
      <Field
        className="pt-input"
        component="select"
        name="address"
        validate={required}
        required
        disabled={isPublicMode}
      >
        <option value={isPublicMode ? this.props.initialValues.address : null}>
          {isPublicMode && this.props.initialValues.address}
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

  componentDidMount() {
    mixpanelWrapper.track("create_contract_loaded");
    this.props.reset();
    !isModePublic() && this.props.fetchAccounts(true, false);
  }

  compilation() {
    const src = this.props.sourceFromEditor ? this.props.sourceFromEditor : (this.props.abi === undefined ? undefined : this.props.abi.src);
    const contractname = this.props.sourceFromEditor ? this.props.contractNameFromEditor : this.props.contractName
    if (src === undefined) {
      return (<tr>
        <td colSpan={3}>
          <div className="text-center">Upload Contract</div>
        </td>
      </tr>);
    } else {
      let contract = src[contractname];
      if (contract && contract['constr'] !== undefined) {
        return Object.getOwnPropertyNames(contract['constr']).map((arg, i) => {
          return (
            <tr key={'arg' + i}>
              <td>{arg}</td>
              <td>{contract.constr[arg].type}</td>
              <td>
                <Field
                  id={arg}
                  className="pt-input"
                  component="input"
                  name={"field" + arg}
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

  renderChainFields() {
    const chainLabel = Object.getOwnPropertyNames(this.props.chainLabel);

    if (chainLabel.length) {
      return (
        <div>
          <div className="row">
            <div className="col-sm-3 text-right">
              <label className="pt-label smd-pad-4">
                Chain
          </label>
            </div>
            <div className="col-sm-9 smd-pad-4">
              <div className="pt-select">
                <Field
                  className="pt-input"
                  component="select"
                  name="chainLabel"
                  onChange={
                    (e) => this.props.getLabelIds(e.target.value)
                  }
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
              <label className="pt-label smd-pad-4">
                Chain IDs
          </label>
            </div>
            <div className="col-sm-9 smd-pad-4">
              <div className="pt-select smd-max-width">
                <Field
                  className="pt-input smd-max-width"
                  component="select"
                  name="chainId"
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
    const { handleSubmit, pristine, submitting, valid } = this.props;
    const contracts = this.props.sourceFromEditor ? Object.keys(this.props.sourceFromEditor) : this.props.abi && this.props.abi.src && Object.keys(this.props.abi.src);
    const isPublicMode = isModePublic();

    return (
      <div className="smd-pad-16" style={{ display: 'inline-block' }}>
        <Button onClick={() => {
          mixpanelWrapper.track("create_contract_open_click");
          this.props.fetchChainIds();
          this.props.contractOpenModal();
        }}
          id="tour-create-contract-button"
          className="pt-intent-primary pt-icon-add"
          text="Create Contract"
          disabled={(this.props.enableCreateContract !== undefined && !this.props.enableCreateContract) ? true : false}
        />
        <form>
          <Dialog
            iconName="inbox"
            isOpen={this.props.isOpen}
            onClose={this.props.contractCloseModal}
            title="Create New Contract"
            className="pt-dark"
          >
            <div className="pt-dialog-body">
              {this.renderChainFields()}
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Username
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  {this.renderUsername(isPublicMode)}
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Address
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  {this.renderAddress(isPublicMode)}
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
                    validate={required}
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
                      onChange={this.handleContractSearchabilityChange}
                      required
                    />
                    <span className="pt-control-indicator"></span>
                    Searchable
                </label>
                </div>
              </div>
              {!this.props.sourceFromEditor &&
                <div className="row">
                  <div className="col-sm-3 text-right">
                    <label className="pt-label smd-pad-4" style={{ margin: 0 }}>
                      Source file
                    </label>
                  </div>
                  <div className="col-sm-9 smd-pad-4">
                    <Field
                      id="input-b"
                      className="form-width pt-input"
                      name="contract"
                      component={this.renderDropzoneInput}
                      dir="auto"
                      title="Contract Source"
                      validate={this.isValidFileType}
                      required
                    />
                  </div>
                </div>
              }
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
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
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
                }} />
                <Button
                  type="submit"
                  onClick={handleSubmit(this.submit)}
                  disabled={pristine || submitting || !valid}
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

export const validate = (values) => {
  const errors = {};

  // const abi = CreateContract.props.abi.src;

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

export const CREATE_CONTRACT_FORM = 'create-contract'

const selector = formValueSelector(CREATE_CONTRACT_FORM);

export function mapStateToProps(state) {
  return {
    isOpen: state.createContract.isOpen,
    abi: state.createContract.abi,
    createDisabled: state.createContract.createDisabled,
    contractName: state.createContract.contractName,
    contract: state.createContract.contract,
    accounts: state.accounts.accounts,
    username: state.createContract.username,
    isToasts: state.createContract.isToasts,
    toastsMessage: state.createContract.toastsMessage,
    currentUser: state.user.currentUser,
    searchable: selector(state, 'searchable'),
    initialValues: {
      username: state.user.currentUser.username,
      address: state.user.currentUser.accountAddress
    },
    chainLabel: state.chains.listChain,
    chainLabelIds: state.chains.listLabelIds
  };
}

const formed = reduxForm({ form: CREATE_CONTRACT_FORM, validate })(CreateContract);
const connected = connect(mapStateToProps, {
  contractOpenModal,
  contractCloseModal,
  createContract,
  compileContract,
  contractFormChange,
  fetchContracts,
  fetchAccounts,
  fetchUserAddresses,
  usernameChange,
  contractNameChange,
  resetError,
  fetchChainIds,
  getLabelIds
})(formed);

export default withRouter(connected);
