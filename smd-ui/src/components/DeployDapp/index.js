import React, { Component } from 'react';
import {
  deployDappOpenModal,
  deployDappCloseModal,
  deployDapp,
  contractFormChange,
  usernameChange,
  chainNameChange,
  resetError
} from './deployDapp.actions';
import { Button, Dialog, Popover, PopoverInteractionKind, Position, AnchorButton } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { required } from '../../lib/reduxFormsValidations'
import { toasts } from "../Toasts";
import { fetchChainIds, getLabelIds } from '../Chains/chains.actions';
import AddMember from '../CreateChain/components/AddMember';
import AddIntegration from '../CreateChain/components/AddIntegration';
import './deployDapp.css';

// TODO: use solc instead of /contracts/xabi for compile

class DeployDapp extends Component {

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

  componentWillReceiveProps(nextProps) {
    if (nextProps.isToasts) {
      toasts.show({ message: nextProps.toastsMessage });
      this.props.resetError();
    }
  }

  handleUsernameChange = (e) => {
    this.props.usernameChange(e.target.value);
    this.props.fetchUserAddresses(e.target.value, true)
  };

  handleContractNameChange = (e) => {
    this.props.sourceFromEditor ?
      this.props.onChangeEditorContractName(e.target.value)
      : this.props.chainNameChange(
        e.target.value
      );
  }

  isValidFileType = (files) => {
    if (!files || !files[0])
      return 'Please add contract source file'
    const contractSource = files[0];
    if (!contractSource.name.includes('.sol'))
      return 'It should be an .sol extention file';
  };

  submit = (values) => {
    const fileText = this.props.textFromEditor ? this.props.textFromEditor : this.props.contract
    values.members = this.state.members;
    values.integrations = this.state.integrations;
    values.governanceContract = fileText;
    values.vm = this.state.vm;
    let errors = validate(values);
    this.setState({ errors });

    const args = {};
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

      this.props.deployDapp(values.dappName, members, balances, integrations, values.governanceContract, values.chainName, args, values.vm);
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
    integrations.splice(index, 1);
    this.setState({
      integrations: integrations
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
              <span>{`${integration.name}: ${integration.chainId.slice(0,16)}...`
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
          <span className="pt-dialog-header-title">No App Integrations</span>
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

    return (
      <div className="smd-pad-16" style={{ display: 'inline-block' }}>
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

        <AnchorButton 
          onClick={() => {
            mixpanelWrapper.track("deploy_dapp_open_click");
            this.props.deployDappOpenModal();
          }}
          id="tour-deploy-dapp-button"
          className="pt-intent-primary pt-icon-add"
          text={"Deploy DApp"}
          disabled={ (this.props.enableCreateContract !== undefined && !this.props.enableCreateContract) || !this.props.userCertificate}
          />
        </Popover>
        <form>
          <Dialog
            iconName="inbox"
            isOpen={this.props.isOpen}
            onClose={this.props.deployDappCloseModal}
            title="Deploy New DApp"
            className="pt-dark deploy-dapp-dialog"
          >
            <div className="pt-dialog-body">
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    DApp Name
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <Field
                    name="dappName"
                    component="input"
                    type="text"
                    placeholder="DApp Name"
                    className="pt-input form-width"
                    tabIndex="1"
                    required
                    />
                  <span className="error-text">{this.errorMessageFor('dappName')}</span>
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
                      name="chainName"
                      onChange={this.handleChainNameChange}
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
              <div className="row">
                <div className="pt-form-group col-sm-12 pt-intent-danger">
                  <label className="pt-label" htmlFor="input-b">
                    DApp Members
                  </label>
                  {this.showMembers(this.state.members)}
                  <span className="error-text">{this.errorMessageFor('members')}</span>
                  <AddMember handler={this.updateMembers} publicKey={this.props.publicKey}/>
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
                  mixpanelWrapper.track("deploy_dapp_cancel");
                  this.props.deployDappCloseModal()
                }} />
                <Button
                  type="submit"
                  onClick={handleSubmit(this.submit)}
                  disabled={pristine || submitting || !valid}
                  text="Deploy DApp"
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

export const DEPLOY_DAPP_FORM = 'deploy-dapp'


export function mapStateToProps(state) {
  return {
    isOpen: state.deployDapp.isOpen,
    abi: state.deployDapp.abi,
    createDisabled: state.deployDapp.createDisabled,
    chainName: state.deployDapp.chainName,
    contract: state.deployDapp.contract,
    isToasts: state.deployDapp.isToasts,
    toastsMessage: state.deployDapp.toastsMessage,
    toastsError: state.deployDapp.error,
    codeType: state.codeEditor.codeType,
    initialValues: {
    },
    userCertificate: state.user.userCertificate,
  };
}

const formed = reduxForm({ form: DEPLOY_DAPP_FORM, validate })(DeployDapp);
const connected = connect(mapStateToProps, {
  deployDappOpenModal,
  deployDappCloseModal,
  deployDapp,
  contractFormChange,
  usernameChange,
  chainNameChange,
  resetError,
  fetchChainIds,
  getLabelIds
})(formed);

export default withRouter(connected);
