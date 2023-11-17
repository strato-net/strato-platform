import React, { Component } from 'react';
import {
  contractOpenModal,
  contractCloseModal,
  createContract,
  compileContract,
  contractFormChange,
  usernameChange,
  contractNameChange,
  resetError,
  updateUsingSampleContract
} from './createContract.actions';
import { fetchAccounts, fetchUserAddresses } from '../Accounts/accounts.actions';
import { fetchContracts } from '../Contracts/contracts.actions';
import { Button, Dialog, Popover, PopoverInteractionKind, Position, AnchorButton, Switch } from '@blueprintjs/core';
import Dropzone from 'react-dropzone'
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { required } from '../../lib/reduxFormsValidations'
import { toasts } from "../Toasts";
import { isOauthEnabled } from '../../lib/checkMode';
import { fetchChainIds, getLabelIds } from '../Chains/chains.actions';
import SampleContracts from './contracts/SampleContracts';
import './createContract.css';
import HexText from '../HexText';
import { useEffect, useState } from 'react';

// TODO: use solc instead of /contracts/xabi for compile

class CreateContract extends Component {
  constructor(props) {
    super();
    this.state = {
      useWallet: false,
    };
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.isToasts) {
      toasts.show({ message: nextProps.toastsMessage });
      this.props.resetError();
    }
  }

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
            return (<p className="pt-intent-success">{acceptedFiles.length > 0 && !this.props.usingSampleContract ? acceptedFiles[0].name : 'Drop a file here, or click to select files to upload.'}</p>)
          }}
        </Dropzone>
        {touchedAndHasErrors && <span className="error">{field.meta.error}</span>}
      </div>
    );
  };

  toggleWalletUsage = (e) => {
    this.setState({ useWallet : !this.state.useWallet }, () => {})
  }

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
    if (this.props.usingSampleContract) {
      this.props.updateUsingSampleContract(false);
    }
  };

  handleSampleContract = (contractName) => {
    this.props.touch('contract');
    let contractSrc = SampleContracts[contractName];
    const self = this;
    mixpanelWrapper.track("sample_contract_select");
    self.props.contractFormChange(contractSrc);
    self.props.compileContract(
      contractName,
      contractSrc,
      self.props.solidvm
    );
    if (!this.props.usingSampleContract) {
      this.props.updateUsingSampleContract(true);
    }
  }

  isValidFileType = (files) => {
    if (files && !this.props.usingSampleContract) {
      if (!files || !files[0])
        return 'Please add contract source file'
      const contractSource = files[0];
      if (!contractSource.name.includes('.sol'))
        return 'It should be an .sol extention file';
    }
  };

  submit = (values) => {
    const args = {};
    const contractname = this.props.sourceFromEditor ? this.props.contractNameFromEditor : this.props.contractName;
    const abi = this.props.sourceFromEditor ? this.props.sourceFromEditor : this.props.abi.src;
    Object.values(abi).forEach(val => {
      if (val.constr && val.constr.args !== undefined) {
        return Object.getOwnPropertyNames(val.constr.args).forEach((arg) => {
          if (values[`field${arg}`] !== undefined) {
            let val = values[`field${arg}`]
            try {
              args[arg] = JSON.parse(val)
            } catch (e) {
              args[arg] = val;
            }
          }
        })
      }
    });
    const fileText = this.props.textFromEditor ? this.props.textFromEditor : this.props.contract

    const contracts = this.props.sourceFromEditor ? Object.keys(this.props.sourceFromEditor) : this.props.abi && this.props.abi.src && Object.keys(this.props.abi.src);
    const metadata = { VM: this.props.codeType ? this.props.codeType : 'SolidVM' };
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
    });

    const payload = {
      contract: contractname,
      username: values.username,
      address: values.address,
      password: isOauthEnabled() ? null : values.password,
      solidvm: values.solidvm,
      fileText: fileText,
      arguments: args,
      chainId: this.props.selectedChain ? this.props.selectedChain : undefined,
      metadata: metadata,
      useWallet: this.state.useWallet
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
        disabled={isModeOauth}
      >
        <option value={isModeOauth ? this.props.initialValues.commonName : null}>
          {isModeOauth && this.props.initialValues.commonName}
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

  render() {
    const { handleSubmit, pristine, submitting, valid, toastsError } = this.props;
    const contracts = this.props.sourceFromEditor ? Object.keys(this.props.sourceFromEditor) : this.props.abi && this.props.abi.src && Object.keys(this.props.abi.src);
    const isModeOauth = isOauthEnabled();

    return (
      <div className="smd-pad-16" style={{ display: 'inline-block' }}>
        <Popover 
          isDisabled={!!this.props.userCertificate}
          interactionKind={PopoverInteractionKind.HOVER}
          position={Position.LEFT}
          content={
            <div className='pt-dark pt-callout pt-icon-info-sign pt-intent-warning'>
              <h5 className="pt-callout-title">Verification Required</h5>
                Your identity must be verified before you can do this action.
            </div>
          }
        >

        <AnchorButton onClick={() => {
          mixpanelWrapper.track("create_contract_open_click");
          this.props.contractOpenModal();
          this.props.initialize(this.props.initialValues);
          this.props.getLabelIds(this.props.initialValues.chainLabel)
        }}
          id="tour-create-contract-button"
          className="pt-intent-primary pt-icon-add"
          text={"Create Contract"}
          disabled={ (this.props.enableCreateContract !== undefined && !this.props.enableCreateContract) || !this.props.userCertificate}
        />
        </Popover>
        <form>
          <Dialog
            iconName="inbox"
            isOpen={this.props.isOpen}
            onClose={this.props.contractCloseModal}
            title="Create New Contract"
            className="pt-dark create-contract-dialog"
          >
            <div className="pt-dialog-body">
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
                  <label className="pt-label smd-pad-4">
                    Name
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
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Use Wallet
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <Switch
                    checked={this.state.useWallet}
                    onChange={this.toggleWalletUsage}
                  />
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
              {!this.props.sourceFromEditor && <div className="row">
                  <div className="col-sm-3 text-right">
                    <label className="pt-label smd-pad-4" style={{ margin: 0 }}>
                      Source files
                    </label>
                  </div>
                  <div className="col-sm-9 smd-scrollable smd-pad-4">
                    <div className='pt-select'>
                      <Field
                        className="pt-select"
                        component="select"
                        name="sampleContract"
                        onChange={(e) => {
                          if (e.target.value !== "default")
                            this.handleSampleContract(e.target.value);
                        }}
                      >
                        <option key={0} value="default">Choose a sample contract to upload.</option>
                        <option key={1} value="HelloWorld">Hello World</option>
                        <option key={2} value="SimpleStorage">Simple Storage</option>
                        <option key={3} value="ERC20">ERC20 - Tokens</option>
                        <option key={4} value="ERC721">ERC721 - NFT</option>
                        <option key={5} value="PermissionManager">Permission Manager</option>
                      </Field>
                    </div>
                  </div>
                  <div className="row">
                    <div className="text-center smd-pad-4">
                      Or
                    </div>
                  </div>
                  <div className="row">
                    <div className="col-sm-12 smd-pad-4">
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
                    VM
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  {this.props.codeType}
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
              {toastsError && <div className="row">
                <div className="col-sm-12">
                  <hr />
                  <h5>Error:</h5>
                  <pre className="smd-scrollable">
                    {toastsError}
                  </pre>
                </div>
              </div>}
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
  // Object.getOwnPropertyNames(values).forEach((val) => {
  //   if (values[val] === '' || values[val] === undefined) {
  //     errors[val] = val + " Required";
  //   }
  // });
  return errors
};

export const CREATE_CONTRACT_FORM = 'create-contract'


export function mapStateToProps(state) {
  const selectedChainData = state.chains.chainIds.find((data) => data.id ===  state.chains.selectedChain)
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
    toastsError: state.createContract.error,
    usingSampleContract: state.createContract.usingSampleContract,
    codeType: state.codeEditor.codeType,
    initialValues: {
      commonName: state.user.userCertificate ? state.user.userCertificate.commonName : 'Verification Pending',
      address: state.user.userCertificate ? state.user.userCertificate.userAddress : 'Verification Pending',
      chainLabel: state.chains.selectedChain ? selectedChainData.label || '' : '',
      chainId: state.chains.selectedChain ? state.chains.selectedChain : ''
    },
    chainLabel: state.chains.listChain,
    chainLabelIds: state.chains.listLabelIds,
    selectedChain: state.chains.selectedChain,
    userCertificate: state.user.userCertificate,
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
  getLabelIds,
  updateUsingSampleContract
})(formed);

export default withRouter(connected);
