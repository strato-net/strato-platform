import React, { Component } from 'react';
import { openCreateChainOverlay, closeCreateChainOverlay, createChain, resetError, compileChainContract, resetContract, contractNameChange } from './createChain.actions';
import { Button, Dialog, Intent, Popover, AnchorButton, PopoverInteractionKind, Position } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import AddMember from './components/AddMember';
import AddIntegration from './components/AddIntegration';
import './createChain.css';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { validate } from './validate';
import { toasts } from '../Toasts';
import Dropzone from 'react-dropzone';
import EVMContracts from './contracts/EVMGovernanceContracts';
import SolidVMContracts from './contracts/SolidVMGovernanceContracts'
import { fetchUserPubkey } from "../User/user.actions";
class CreateChain extends Component {

  constructor(props) {
    super(props);
    this.state = {
      form: {
        contractSelected: 'Governance'
      },
      droppedFileName: '',
      members: [],
      integrations: [],
      errors: null,
      governanceContract: '',
      vm: true
    };
    this.updateMembers = this.updateMembers.bind(this);
    this.removeMember = this.removeMember.bind(this);
    this.updateIntegrations = this.updateIntegrations.bind(this);
    this.removeIntegration = this.removeIntegration.bind(this);
  }

  componentDidMount() {
    mixpanelWrapper.track("create_chain_loaded");
    this.props.fetchUserPubkey();
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.createErrorMessage) {
      toasts.show({ message: nextProps.createErrorMessage });
      this.props.resetError();
    }
  }

  submit = (values) => {
    values.members = this.state.members;
    values.integrations = this.state.integrations;
    values.governanceContract = this.state.governanceContract;
    values.vm = this.state.vm;
    let errors = validate(values);
    this.setState({ errors });

    if (!Object.values(errors).length) {
      mixpanelWrapper.track('create_chain_submit_click');
      let members = [];
      let integrations = {};
      let balances = [];

      this.state.members.forEach(function (member) {
        members.push({
          "orgName": member.orgName && member.orgName !== '' ? member.orgName : undefined,
          "orgUnit": member.orgUnit && member.orgUnit !== '' ? member.orgUnit : undefined,
          "commonName": member.commonName && member.commonName !== '' ? member.commonName : undefined,
          "access": member.access
        });
      });

      this.state.integrations.forEach(function (i) {
        integrations = { ...integrations, [i.name]: i.chainId }
      });

      balances.push({
        "balance": 1000000000000000,
        "address": '0000000000000000000000000000000000000100'
      });

      const args = {};
      if (this.props.abi) {
        const abi = this.props.abi.src;
        // This will take out all the constants defined in contract and append it to args
        Object.values(abi).forEach(val => {
          if (Object.keys(val.vars).length) {
            Object.getOwnPropertyNames(val.vars).forEach((arg) => {
              const v = val.vars[arg];
              if (v.initialValue !== null) {
                args[arg] = v.initialValue;
              } else if (v.type !== 'Mapping' && v.type !== 'Struct') {
                try {
                  args[arg] = JSON.parse(values[arg]);
                } catch (e) {
                  args[arg] = values[arg];
                }
              }
              else {
                try {
                  args[arg] = JSON.parse(values[arg]);
                } catch (e) {
                  args[arg] = values[arg]
                }
              }
            });
          }
          if (val.constr && val.constr.args !== undefined) {
            Object.getOwnPropertyNames(val.constr.args).forEach((arg) => {
              if (values[arg] !== undefined) {
                let val = values[arg]
                try {
                  args[arg] = JSON.parse(val)
                } catch (e) {
                  args[arg] = val;
                }
              }
            })
          }
        });
      }

      this.props.createChain(values.chainName, members, balances, integrations, values.governanceContract, args, values.vm, this.props.contractName, this.props.limit, this.props.offset);
      this.setState({
        members: [],
        integrations: [],
      });
    }
  }

  updateMembers(state) {
    const curMembers = this.state.members;

    this.setState({
      members: curMembers.concat({
        orgName: state.orgName,
        orgUnit: state.orgUnit,
        commonName: state.commonName,
        access: state.access
      })
    });
  }

  updateIntegrations(state) {
    const curIntegrations = this.state.integrations;

    this.setState({
      integrations: curIntegrations.concat({
        name: state.name,
        chainId: state.chainId,
      })
    });
  }

  removeMember(member) {
    const members = this.state.members.slice(0);
    const index = members.indexOf(member);
    members.splice(index, 1);
    this.setState({
      members: members
    });
  }

  removeIntegration(integration) {
    const integrations = this.state.integrations.slice(0);
    const index = integrations.indexOf(integration);
    const newIntegrations = integrations.slice(index, 1);
    this.setState({
      integrations: newIntegrations
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
              <span>{member.orgName
                ? member.orgUnit
                  ? member.commonName
                    ? `${member.access ? 'Include' : 'Exclude'} ${member.commonName} from ${member.orgUnit} at ${member.orgName}`
                    : `${member.access ? 'Include' : 'Exclude'} everyone from ${member.orgUnit} at ${member.orgName}`
                  : `${member.access ? 'Include' : 'Exclude'} everyone at ${member.orgName}`
                : `${member.access ? 'Include' : 'Exclude'} everyone`
              }</span>
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

  showIntegrations(integrations) {
    if (integrations.length && integrations.length > 0) {
      const ret = [];
      integrations.forEach(function (integration, index) {
        ret.push(
          <div className="row smd-margin-8 integration smd-vertical-center" key={index}>
            <div className="col-sm-1"></div>
            <div className="col-sm-9">
              <span>{`${integration.name} ${integration.chainId}`
              }</span>
            </div>
            <div className="col-sm-2">
              <Button
                className="pt-button pt-icon-trash integration-remove"
                onClick={() => {
                  this.removeIntegration(integration)
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
        <div className="pt-dialog-header no-integration">
          <span className="pt-dialog-header-title">No DApp Integrations</span>
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
    if (contractSource.name.slice(contractSource.name.length - 4) !== '.sol')
      return 'It should be an .sol extention file';
  };

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
  findGovernanceContractSrc = (contractName) => {
    let contractObjSrc = this.state.vm ? SolidVMContracts : EVMContracts
    this.updateGovernanceContract(contractName, contractObjSrc[contractName])
  }
  updateGovernanceContract = (fileName, fileContents) => {
    this.setState({ governanceContract: fileContents })
    this.props.compileChainContract(
      fileName,
      fileContents,
      false,
      this.state.vm
    );
  }

  compilation() {
    const src = this.props.abi && this.props.abi.src;
    const contractname = this.props.contractName;

    if (src) {
      let contract = src[contractname];
      let count = 0;
      if (contract && this.state.vm && contract.constr) {
        return Object.getOwnPropertyNames(contract['constr'].args).map((arg, i) => {
          const v = contract.constr.args[arg];
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
        });
      }
      else if (contract && !this.state.vm && Object.keys(contract['vars']).length) {
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
            <div className="text-center">No Variables</div>
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

  handleContractNameChange = (e) => {
    this.props.contractNameChange(e.target.value);
  }

  render() {
    const contracts = this.props.abi ? Object.keys(this.props.abi.src) : [];

    return (
      <div className="smd-pad-16">
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

          <AnchorButton onClick={() => {
            mixpanelWrapper.track('create_chain_open_click');
            this.props.reset();
            this.props.openCreateChainOverlay();
          }} className="pt-intent-primary pt-icon-add"
          id="chains-create-chain-button"
          disabled={!this.props.userCertificate}
          text={"Create Shard"} />
        </Popover>

        <Dialog
          iconName="flows"
          isOpen={this.props.isOpen}
          onClose={this.props.closeCreateChainOverlay}
          title="Create New Shard"
          className="pt-dark"
        >
          <form>
            <div className="pt-dialog-body create-chain-form">

              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Shard Name
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <Field
                    name="chainName"
                    component="input"
                    type="text"
                    placeholder="Shard Name"
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
                        this.findGovernanceContractSrc('AutoApprove');
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
                        this.findGovernanceContractSrc('TwoIn');
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
                        this.findGovernanceContractSrc('MajorityRules');
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
                        this.findGovernanceContractSrc('AdminOnly');
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
                  /> Upload file
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right" />
                <div className="col-sm-9 smd-pad-4">
                  {this.state.form.contractSelected === 'Governance' &&
                    <Field
                      id="input-b"
                      name="contract"
                      component={this.renderDropzoneInput}
                      dir="auto"
                      title="Contract Source"
                    />
                  }
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    VM
                  </label>
                </div>
                <div className="col-sm-9 smd-scrollable smd-pad-4">
                  <div className='pt-select'>
                    <Field
                      className="pt-select"
                      component="select"
                      name="vm"
                      onChange={(e) => {
                        this.setState({ vm: e.target.value === "SolidVM" })
                      }}
                    >
                      <option key={0} value="SolidVM">SolidVM</option>
                      <option key={1} value="EVM">EVM</option>
                    </Field>
                  </div>
                </div>
              </div>
              {contracts.length > 0 && <div className="row">
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
                    Arguments
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
                    Shard Members
                  </label>
                  {this.showMembers(this.state.members)}
                  <span className="error-text">{this.errorMessageFor('members')}</span>
                  <AddMember handler={this.updateMembers} publicKey={this.props.publicKey} />
                </div>
              </div>
              
              <div className="row">
                <div className="pt-form-group col-sm-12 pt-intent-danger">
                  <label className="pt-label" htmlFor="input-b">
                    DApp Integrations
                  </label>
                  {this.showIntegrations(this.state.integrations)}
                  <span className="error-text">{this.errorMessageFor('integrations')}</span>
                  <AddIntegration handler={this.updateIntegrations} />
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
                  text="Create Shard"
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
    contractName: state.createChain.contractName,
    publicKey: state.user.publicKey,
    userCertificate: state.user.userCertificate,
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
    resetContract,
    fetchUserPubkey,
    contractNameChange
  }
)(formed);

export default withRouter(connected);
