import React, { Component } from 'react';
import { openCreateChainOverlay, closeCreateChainOverlay, createChain, resetError, compileChainContract, resetContract } from './createChain.actions';
import { Button, Dialog, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import AddMember from './components/AddMember';
import './createChain.css';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { validate } from './validate';
import { toasts } from '../Toasts';
import Dropzone from 'react-dropzone';
import { autoApprove } from './contracts/AutoApprove';
import { twoIn } from './contracts/TwoIn';
import { majorityRules } from './contracts/MajorityRules';
import { adminOnly } from './contracts/AdminOnly';

class CreateChain extends Component {

  constructor(props) {
    super(props);
    this.state = {
      form: {
        contractSelected: 'Governance'
      },
      droppedFileName: '',
      members: [],
      errors: null,
      governanceContract: ''
    };
    this.updateMembers = this.updateMembers.bind(this);
    this.removeMember = this.removeMember.bind(this);
  }

  componentDidMount() {
    mixpanelWrapper.track("create_chain_loaded");
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.createErrorMessage) {
      toasts.show({ message: nextProps.createErrorMessage });
      this.props.resetError();
    }
  }

  submit = (values) => {
    values.members = this.state.members;
    values.governanceContract = this.state.governanceContract;
    let errors = validate(values);
    this.setState({ errors });

    if (!Object.values(errors).length) {
      mixpanelWrapper.track('create_chain_submit_click');
      let members = [];
      let balances = [];

      this.state.members.forEach(function (member, index) {
        members.push({
          "address": member.address,
          "enode": member.enode
        });
        balances.push({
          "balance": member.balance,
          "address": member.address
        });
      });

      const args = {};
      if (this.props.abi) {
        const abi = this.props.abi.src;
        // This will take out all the constants defined in contract and append it to args
        Object.values(abi).forEach(val => {
          if (Object.keys(val.vars).length) {
            Object.getOwnPropertyNames(val.vars).forEach((arg) => {
              const v = val.vars[arg];
              console.log(arg); console.log(v);
              if (v.initialValue !== null) {
                args[arg] = v.initialValue;
              } else if (v.type !== 'Mapping'
                && v.type !== 'Struct') {
                args[arg] = values[arg];
              }
            })
          }
        });
      }

      this.props.createChain(values.chainName, members, balances, values.governanceContract, args);
      this.setState({
        members: [],
      });
    }
  }

  updateMembers(state) {
    const curMembers = this.state.members;
    const addresses = [];

    curMembers.forEach(function (member) {
      addresses.push(member.address);
    });

    if (!addresses.includes(state.address)) {
      this.setState({
        members: curMembers.concat({
          username: state.username,
          address: state.address,
          enode: state.enode,
          balance: parseInt(state.balance, 10)
        })
      });
    }
  }

  removeMember(member) {
    const members = this.state.members.slice(0);
    const index = members.indexOf(member);
    members.splice(index, 1);
    this.setState({
      members: members
    });
  }

  showMembers(members) {
    if (members.length && members.length > 0) {
      const ret = [];
      members.forEach(function (member, index) {
        ret.push(
          <div className="row smd-margin-8 member smd-vertical-center" key={index}>
            <div className="col-sm-1"></div>
            <div className="col-sm-9">
              <span>{member.username ? member.username + ' (' + member.address + ')' : member.address}</span>
            </div>
            <div className="col-sm-2">
              <Button
                className="pt-button pt-icon-trash member-remove"
                onClick={() => {
                  this.removeMember(member)
                }}
              />
            </div>
          </div>
        );
      }.bind(this))
      return ret;
    }
    else {
      return (
        <div className="pt-dialog-header no-member">
          <span className="pt-dialog-header-title">No Members</span>
        </div>
      );
    }
  }

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  isValidFileType = (files) => {
    if (!files || !files[0])
      return 'Please add contract source file'
    const contractSource = files[0];
    if (!contractSource.name.includes('.sol'))
      return 'It should be an .sol extention file';
  };

  renderDropzoneInput = (field) => {
    const touchedAndHasErrors = field.meta.touched && field.meta.error
    return (
      <div className="dropzoneContainer text-center chain-dropzone">
        <Dropzone
          className="dropzone"
          name={field.name}
          onDrop={(filesToUpload, e) => this.handleFileDrop(filesToUpload, field)}
        >
          {({ isDragActive, isDragReject, acceptedFiles }) => {
            if (isDragActive) {
              return (<p className="pt-intent-success">Drop to Upload!</p>);
            }
            return (<p className="pt-intent-success">{acceptedFiles.length > 0 ? acceptedFiles[0].name : 'Drop file here or click to upload'}</p>)
          }}
        </Dropzone>
        {touchedAndHasErrors && <span className="error-text">{field.meta.error}</span>}
      </div>
    );
  };

  handleFileDrop = (files, dropZoneField) => {
    this.props.touch('contract');
    dropZoneField.input.onChange(files);
    const file = files[0];
    this.setState({ droppedFileName: file });
    this.handleContractFile(file);
  };

  handleContractFile = (file) => {
    if (file) {
      let reader = new FileReader();
      const self = this;
      reader.onload = function (event) {
        const fileName = file.name.substring(0, file.name.indexOf('.'));
        const fileContents = event.target.result;//.replace(/\r?\n|\r/g, " ");
        mixpanelWrapper.track("create_contract_file_upload");
        self.updateGovernanceContract(fileName, fileContents);
      };
      reader.readAsText(file);
    } else {
      this.props.resetContract();
    }
  }

  updateGovernanceContract = (fileName, fileContents) => {
    this.setState({ governanceContract: fileContents })
    this.props.compileChainContract(
      fileName,
      fileContents,
      false
    );
  }

  compilation() {
    const src = this.props.abi && this.props.abi.src;
    const contractname = this.props.contractName;

    if (src) {
      let contract = src[contractname];
      let count = 0;
      if (contract && Object.keys(contract['vars']).length) {
        return Object.getOwnPropertyNames(contract['vars']).map((arg, i) => {
          const v = contract.vars[arg];
          if (v.initialValue
            || v.type === 'Mapping'
            || v.type === 'Struct') {
            return null;
          } else {
            count++;
            return (<tr key={'arg' + i}>
              <td style={{ paddingTop: '10px' }}>{arg}</td>
              <td>
                <Field
                  name={arg}
                  component="input"
                  type="text"
                  placeholder={v.type}
                  className="pt-input"
                />
              </td>
            </tr>);
          }
        });
      }
      if (count === 0) {
        return (<tr>
          <td colSpan={3}>
            <div className="text-center">No variables</div>
          </td>
        </tr>)
      }

    } else {
      return (<tr>
        <td colSpan={3}>
          <div className="text-center">Upload Contract</div>
        </td>
      </tr>);
    }
  }

  render() {
    return (
      <div className="smd-pad-16">
        <Button onClick={() => {
          mixpanelWrapper.track('create_chain_open_click');
          this.props.reset();
          this.props.openCreateChainOverlay();
        }} className="pt-intent-primary pt-icon-add"
          id="chains-create-chain-button"
          text="Create Chain" />

        <Dialog
          iconName="flows"
          isOpen={this.props.isOpen}
          onClose={this.props.closeCreateChainOverlay}
          title="Create New Chain"
          className="pt-dark"
        >
          <form>
            <div className="pt-dialog-body create-chain-form">

              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Chain Name
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <Field
                    name="chainName"
                    component="input"
                    type="text"
                    placeholder="Chain Name"
                    className="pt-input form-width"
                    tabIndex="1"
                    required
                  />
                  <span className="error-text">{this.errorMessageFor('chainName')}</span>
                </div>
              </div>

              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4" style={{ margin: 0 }}>
                    Contract
                  </label>
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right" />
                <div className="col-sm-9 smd-pad-4">
                  <Field
                    name="radio"
                    component="input"
                    type="radio"
                    value={0}
                    label='AutoApprove'
                    checked={this.state.form.contractSelected === 'AutoApprove'}
                    onClick={
                      () => {
                        this.setState((prevState) => {
                          return {
                            form: { contractSelected: 'AutoApprove' }
                          };
                        });
                        this.updateGovernanceContract('AutoApprove', autoApprove);
                      }
                    }
                  /> AutoApprove
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right" />
                <div className="col-sm-9 smd-pad-4">
                  <Field
                    name="radio"
                    component="input"
                    type="radio"
                    value={0}
                    label='TwoIn'
                    checked={this.state.form.contractSelected === 'TwoIn'}
                    onClick={
                      () => {
                        this.setState((prevState) => {
                          return {
                            form: { contractSelected: 'TwoIn' }
                          };
                        });
                        this.updateGovernanceContract('TwoIn', twoIn);
                      }
                    }
                  /> TwoIn
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right" />
                <div className="col-sm-9 smd-pad-4">
                  <Field
                    name="radio"
                    component="input"
                    type="radio"
                    value={0}
                    label='MajorityRules'
                    checked={this.state.form.contractSelected === 'MajorityRules'}
                    onClick={
                      () => {
                        this.setState((prevState) => {
                          return {
                            form: { contractSelected: 'MajorityRules' }
                          };
                        });
                        this.updateGovernanceContract('MajorityRules', majorityRules);
                      }
                    }
                  /> MajorityRules
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right" />
                <div className="col-sm-9 smd-pad-4">
                  <Field
                    name="radio"
                    component="input"
                    type="radio"
                    value={0}
                    label='AdminOnly'
                    checked={this.state.form.contractSelected === 'AdminOnly'}
                    onClick={
                      () => {
                        this.setState((prevState) => {
                          return {
                            form: { contractSelected: 'AdminOnly' }
                          };
                        });
                        this.updateGovernanceContract('AdminOnly', adminOnly);
                      }
                    }
                  /> AdminOnly
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right" />
                <div className="col-sm-9 smd-pad-4">
                  <Field
                    name="radio"
                    component="input"
                    type="radio"
                    value={1}
                    label='Governance'
                    checked={this.state.form.contractSelected === 'Governance'}
                    onClick={
                      () => {
                        this.setState((prevState) => {
                          return {
                            form: { contractSelected: 'Governance' },
                          };
                        });
                        this.handleContractFile(this.state.droppedFileName);
                      }
                    }
                  />
                  <Field
                    id="input-b"
                    name="contract"
                    component={this.renderDropzoneInput}
                    dir="auto"
                    title="Contract Source"
                  />
                </div>
              </div>

              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Compilation
                  </label>
                </div>
                <div className="col-sm-9 smd-scrollable smd-pad-4">
                  <table className="pt-table pt-condensed pt-striped smd-full-width">
                    <thead>
                      <tr>
                        <th>Arg</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {this.compilation()}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="row">
                <div className="pt-form-group col-sm-12 pt-intent-danger">
                  <label className="pt-label" htmlFor="input-b">
                    Chain Members
                  </label>
                  {this.showMembers(this.state.members)}
                  <span className="error-text">{this.errorMessageFor('members')}</span>
                  <AddMember handler={this.updateMembers} />
                </div>
              </div>
            </div>

            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button text="Cancel" onClick={() => {
                  mixpanelWrapper.track('create_chain_close_click');
                  this.props.reset();
                  this.setState({
                    members: [],
                  });
                  this.props.closeCreateChainOverlay();
                }} />
                <Button
                  intent={Intent.PRIMARY}
                  disabled={this.props.isSpinning}
                  onClick={this.props.handleSubmit(this.submit)}
                  text="Create Chain"
                />
              </div>
            </div>
          </form>
        </Dialog>

      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    isOpen: state.createChain.isOpen,
    isSpinning: state.createChain.spinning,
    createErrorMessage: state.createChain.error,
    abi: state.createChain.abi,
    contractName: state.createChain.contractName
  };
}

const formed = reduxForm({ form: 'create-chain' })(CreateChain);
const connected = connect(
  mapStateToProps,
  {
    openCreateChainOverlay,
    closeCreateChainOverlay,
    createChain,
    resetError,
    compileChainContract,
    resetContract
  }
)(formed);

export default withRouter(connected);
