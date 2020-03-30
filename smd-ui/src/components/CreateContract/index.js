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
import { isOauthEnabled } from '../../lib/checkMode';
import { fetchChainIds, getLabelIds } from '../Chains/chains.actions';
import './createContract.css';

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
        self.props.solidvm
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

  submit = (values) => {
    const args = {};
    const contractname = this.props.sourceFromEditor ? this.props.contractNameFromEditor : this.props.contractName;
    const abi = this.props.sourceFromEditor ? this.props.sourceFromEditor : this.props.abi.src;
    Object.values(abi).forEach(val => {
      if (val.constr && val.constr.args !== undefined) {
        return Object.getOwnPropertyNames(val.constr.args).forEach((arg) => {
          if (values[`field${arg}`] !== undefined)
            args[arg] = values[`field${arg}`];
        })
      }
    });
    const fileText = this.props.textFromEditor ? this.props.textFromEditor : this.props.contract

    const contracts = this.props.sourceFromEditor ? Object.keys(this.props.sourceFromEditor) : this.props.abi && this.props.abi.src && Object.keys(this.props.abi.src);
    const metadata = { VM: this.props.solidvm ? 'SolidVM' : 'EVM' };
    contracts.forEach(function (contract) {
      if (values[`history@${contract}`]) {
        if (metadata['history']) {
          const curHistory = metadata['history'];
          metadata['history'] = curHistory + ',' + contract;
        }
        else {
          metadata['history'] = contract;
        }
      }
      else {
        if (metadata['nohistory']) {
          const curNohistory = metadata['nohistory'];
          metadata['nohistory'] = curNohistory + ',' + contract;
        }
        else {
          metadata['nohistory'] = contract;
        }
      }
      if (values[`noindex@${contract}`]) {
        if (metadata['noindex']) {
          const curNoIndex = metadata['noindex'];
          metadata['noindex'] = curNoIndex + ',' + contract;
        }
        else {
          metadata['noindex'] = contract;
        }
      }
      else {
        if (metadata['index']) {
          const curIndex = metadata['index'];
          metadata['index'] = curIndex + ',' + contract;
        }
        else {
          metadata['index'] = contract;
        }
      }
    });

    const payload = {
      contract: contractname,
      username: values.username,
      address: values.address,
      password: isOauthEnabled() ? null : values.password,
      solidvm: values.solidvm,
      fileText: fileText,
      arguments: args,
      chainId: values.chainId,
      metadata: metadata
    };

    mixpanelWrapper.track('create_contract_submit_click_successful');
    this.props.createContract(payload);
    this.props.reset();
  };

  renderUsername = (isModeOauth) => {
    const users = Object.getOwnPropertyNames(this.props.accounts);
    return (<div className={isModeOauth ? "" : "pt-select"}>
      <Field
        className="pt-input"
        component="select"
        name="username"
        onChange={this.handleUsernameChange}
        validate={required}
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

  renderAddress = (isModeOauth) => {
    const userAddresses = this.props.accounts && this.props.username ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.username])
      : [];
    return (<div className={isModeOauth ? "" : "pt-select"}>
      <Field
        className="pt-input"
        component="select"
        name="address"
        validate={required}
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

  componentDidMount() {
    mixpanelWrapper.track("create_contract_loaded");
    this.props.reset();
    !isOauthEnabled() && this.props.fetchAccounts(true, false);
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
      if (contract && contract['constr'] && contract['constr'].args !== undefined) {
        const funcArgs = contract['constr'].args
        return Object.getOwnPropertyNames(funcArgs).map((arg, i) => {
          return (
            <tr key={'arg' + i}>
              <td>{arg}</td>
              <td>{funcArgs[arg].type}</td>
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
                  className="pt-input chain-field"
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
    const isModeOauth = isOauthEnabled();

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
            className="pt-dark create-contract-dialog"
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
                  {this.renderUsername(isModeOauth)}
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
              </div>}
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
              {contracts && <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    SolidVM
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <label className="pt-control pt-checkbox">
                    <Field
                      id="input-b"
                      className="form-width"
                      name="solidvm"
                      type="checkbox"
                      component="input"
                      dir="auto"
                      title="SolidVM"
                    />
                    <span className="pt-control-indicator"></span>
                  </label>
                </div>
              </div>}
              {contracts && <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    History
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  {contracts.map((value, index) => {
                    return (
                      <label className="pt-control pt-checkbox">
                        <Field
                          id={value}
                          className="form-width"
                          name={"history@" + value}
                          type="checkbox"
                          component="input"
                          dir="auto"
                          title="History"
                        />
                        <span className="pt-control-indicator"></span>
                        {value}
                      </label>
                    )
                  })
                  }
                </div>
              </div>}
              {contracts && <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    No Index
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  {contracts.map((value, index) => {
                    return (
                      <label className="pt-control pt-checkbox">
                        <Field
                          id={value}
                          className="form-width"
                          name={"noindex@" + value}
                          type="checkbox"
                          component="input"
                          dir="auto"
                          title="NoIndex"
                        />
                        <span className="pt-control-indicator"></span>
                        {value}
                      </label>
                    )
                  })
                  }
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
    // TODO: update the testcase for selector
    solidvm: selector(state, 'solidvm'),
    initialValues: {
      username: state.user.oauthUser ? state.user.oauthUser.username : '',
      address: state.user.oauthUser ? state.user.oauthUser.address : ''
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
