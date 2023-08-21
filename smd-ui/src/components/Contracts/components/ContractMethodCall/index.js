import React, { Component } from 'react';
import { Button, Dialog, PopoverInteractionKind, Position, AnchorButton, Popover, Collapse, Switch } from '@blueprintjs/core';
import { connect } from 'react-redux';
import { Link, withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import { Field, reduxForm, formValueSelector } from 'redux-form';
import {
  methodCall,
} from './contractMethodCall.actions';
import './contractMethodCall.css';
import ValueInput from "../../../ValueInput";
import { fetchChainIds, getLabelIds } from '../../../Chains/chains.actions';
import { isOauthEnabled } from '../../../../lib/checkMode';
import HexText from '../../../HexText';

class ContractMethodCall extends Component {

  constructor() {
    super()
    this.state = {
      isFunctionSourceOpen: false,
      isOpen: false,
      useWallet: false,
    }
  }

  handleOpenModal = () => {
    mixpanelWrapper.track("method_call_button_click");
    this.setState({isOpen : true})
  }

  handleCloseModal = (e) => {
    e.stopPropagation();
    e.preventDefault();
    this.props.reset();
    mixpanelWrapper.track("method_call_cancel");
    this.setState({isOpen : false})
  }

  toggleWalletUsage = (e) => {
    this.setState({ useWallet : !this.state.useWallet }, () => {})
  }

  submit = (values) => {
    try {
      let unparsedArgs = [];
      if (this.props.contractInfo.contract && this.props.contractInfo.contract._functions && this.props.contractInfo.contract._functions[this.props.symbolName]) {
        unparsedArgs = this.props.contractInfo.contract._functions[this.props.symbolName]._funcArgs;
      }
      const parsedArgs = unparsedArgs
        .reduce((args, [arg, info]) => {
          try {
            args[arg] = JSON.parse(values[arg]);
            return args;
          }
          catch (e) {
            args[arg] = values[arg];
            return args;
          }
        }, {})
        const payload = {
          contractName: this.props.contractName,
          contractAddress: this.props.contractAddress,
          methodName: this.props.symbolName,
          username: values.modalUsername,
          userAddress: values.modalAddress,
          password: isOauthEnabled() ? '' : values.modalPassword,
          value: values.modalValue,
          args: parsedArgs,
          chainId: this.props.selectedChain ? this.props.selectedChain : undefined,
          useWallet: this.state.useWallet
        }
        mixpanelWrapper.track("method_call_submit");
        this.props.methodCall(this.props.methodKey, payload);
      } catch (e) {
        return
      }
  }

  renderUsername = (isModeOauth) => {
    const users = Object.getOwnPropertyNames(this.props.accounts);
    return (<div className={isModeOauth ? "" : "pt-select"}>
      <Field
        className="pt-input"
        name="modalUsername"
        component="select"
        disabled={isModeOauth}
        required
      >
        <option value={isModeOauth && this.props.userCertificate ? this.props.userCertificate.commonName : "Verification Pending"}>
          {isModeOauth && this.props.userCertificate ? this.props.userCertificate.commonName : "Verification Pending"}
        </option>
        {
          users.map((user, i) => {
            return (
              <option key={'user' + i} value={user.commonName}>{user.commonName}</option>
            )
          })
        }
      </Field>
    </div>)
  }

  renderAddress = () => {
    const userAddresses = Object.keys(this.props.accounts).length && this.props.modalUsername ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.modalUsername])
      : [];
    return (<div className={"pt-select"}>
      <Field
        className="pt-input"
        component="select"
        name="modalAddress"
        disabled={true}
        required
      >
        <option value={this.props.userCertificate ? this.props.userCertificate.userAddress : "Verification Pending"}>
          {this.props.userCertificate ? this.props.userCertificate.userAddress : "Verification Pending"}
        </option>
        {
          userAddresses.map((address, i) => {
            return (
              <option key={address.address} value={address.address}>{address.address}</option>
            )
          })
        }
      </Field>
    </div>)
  }

  renderChainFields() {
    const chainLabel = Object.getOwnPropertyNames(this.props.chainLabel);

    if (chainLabel.length) {
      return (
        <div>
          <div className="row">
            <div className="col-sm-3 text-right">
              <label className="pt-label label-margin">
                Shard
              </label>
            </div>
            <div className="col-sm-9">
              <div className="pt-select">
                <Field
                  className="pt-input"
                  component="select"
                  name="chainLabel"
                  onChange={
                    (e) => this.props.getLabelIds(e.target.value)
                  }
                  required
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
              <label className="pt-label label-margin">
                Shard Ids
              </label>
            </div>
            <div className="col-sm-9">
              <div className="pt-select smd-max-width">
                <Field
                  className="pt-input smd-max-width"
                  component="select"
                  name="chainId"
                  required
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

  handleToggleFunctionSource() {
    this.setState({isFunctionSourceOpen: !this.state.isFunctionSourceOpen})
  }

  render() {
    const params = [];
    const handleSubmit = this.props.handleSubmit;
    const isModeOauth = isOauthEnabled();
    let funcInfo = {};
    if (this.props.contractInfo.contract && this.props.contractInfo.contract._functions) {
      funcInfo = this.props.contractInfo.contract._functions[this.props.symbolName];
    }
    if (funcInfo._funcArgs && funcInfo._funcArgs.length > 0) {
      const self = this;
      funcInfo._funcArgs.forEach(function (arg, i) {
        params.push(
          <tr key={self.props.symbolName + '-args-' + i}>
            <td style={{ paddingTop: '10px' }}>{arg[0]}</td>
            <td>
              <Field
                name={arg[0]}
                component="input"
                type="text"
                placeholder={arg[1].type.tag || ''}
                className="pt-input"
                required
              />
            </td>
          </tr>
        );
      });
    }
    else {
      params.push(
        <tr key={this.props.symbolName + '-params-no-rows'}>
          <td className="text-center" colSpan={3}><i>This method has no params</i></td>
        </tr>
      );
    }
    console.log('HERE')
    return (
      <div>
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
            className="pt-intent-primary pt-icon-send-to-graph"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              this.handleOpenModal();
            }}
            disabled={!this.props.userCertificate}
            text={this.props.symbolName}
          />
        </Popover>
        <form>
          <Dialog
            iconName="exchange"
            isOpen={this.state.isOpen}
            onClose={this.handleCloseModal}
            title={"Call '" + this.props.symbolName + "' on " + this.props.contractName}
            className="pt-dark"
          >
            <div className="pt-dialog-body">
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Contract Address
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  {this.props.contractAddress}
                </div>
              </div>
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
                  <label className="pt-label label-margin">
                    Name
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  {this.renderUsername(isModeOauth)}
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label label-margin">
                    Caller Address
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  {this.renderAddress(isModeOauth)}
                </div>
              </div>
              <div className="row">
                <div className="col-sm-9 smd-pad-4">
                  <Switch
                    checked={this.state.useWallet}
                    onChange={this.toggleWalletUsage}
                    label="Use Wallet"
                  />
                </div>
              </div>
              <div className="row">
                <div className="col-sm-9">
                  <Button onClick={() => this.handleToggleFunctionSource()}>
                    Show Function Source Code
                  </Button>
                </div>
              </div>
              <div className="row smd-margin-4">
                <div className="col-sm-12">
                  <Collapse
                    isOpen={this.state.isFunctionSourceOpen}
                  >
                    <pre >
                      {/* Render the function signature */}
                      function {this.props.symbolName}{`(${funcInfo && funcInfo._funcArgs && funcInfo._funcArgs.length > 0 && funcInfo._funcArgs.map(([key, val]) => {
                        return `${val.type.tag.toLowerCase()} ${key}`
                      }).join(',')})`} {funcInfo && funcInfo._funcVals && funcInfo._funcVals.length > 0 && `returns (${funcInfo._funcVals.map(([key, val]) => {
                          return val.type.tag.toLowerCase();
                      }).join(',')})`} &#123;
                      {/* Render the function body */}
                        {`\n\t`}{/*funcInfo._funcContents || 'Error loading function body'*/}
                      {`\n`}&#125;
                    </pre>
                  </Collapse>
                </div>
              </div>
              {funcInfo.isPayable && <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label label-margin">
                    Value
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <Field
                    name="modalValue"
                    component={ValueInput}
                  />
                </div>
              </div>}
              <div className="row">
                <div className="col-sm-12">
                  <h5>Parameters</h5>
                </div>
              </div>
              <div className="row">
                <div className="col-sm-12 smd-scrollable">
                  <table className="pt-table pt-condensed pt-striped smd-full-width">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {params}
                    </tbody>
                  </table>
                </div>
              </div>
              {
                this.props.methodCallModal.result && !this.props.methodCallModal.loading &&
                <div className="row">
                  <div className="col-sm-12">
                    <hr />
                    <div className={`pt-callout pt-intent-${this.props.methodCallModal.result[0].status == "Success" ? 'success' : this.props.methodCallModal.result[0].status == "Pending" ? 'warning' : 'danger'}`}>
                    <h5>Transaction Results</h5>
                        { this.props.methodCallModal.result[0].hash &&
                    <div className="row">
                      <div className="col-sm-3 text-right">
                        <label className="pt-label label-margin">
                          TX Hash
                        </label>
                      </div>
                      <div className="col-sm-9 smd-pad-4">

                        <HexText value={this.props.methodCallModal.result[0].hash}/>
                      </div>
                    </div>                   
                        }
                    <div className="row">
                      <div className="col-sm-3 text-right">
                        <label className="pt-label label-margin">
                          Status
                        </label>
                      </div>
                      <div className="col-sm-9 smd-pad-4">
                        {this.props.methodCallModal.result[0].status == "Success" || this.props.methodCallModal.result[0].status == "Pending" ? this.props.methodCallModal.result[0].status : 'Failed'}
                      </div>                  
                    </div>
                    { typeof(this.props.methodCallModal.result) == "string" &&
                      <div className="row">
                        <div className="col-sm-3 text-right">
                          <label className="pt-label label-margin">
                            Error:
                          </label>
                        </div>
                        <div className="col-sm-9 smd-pad-4">
                          {this.props.methodCallModal.result}
                        </div>                  
                      </div>
                    }
                    {this.props.methodCallModal.result[0].status == "Success" &&
                      <div>
                        <div className="row">
                          <div className="col-sm-3 text-right">
                            <label className="pt-label label-margin">
                              Time
                            </label>
                          </div>
                          <div className="col-sm-9 smd-pad-4">
                            {this.props.methodCallModal.result[0].txResult.time}s
                          </div>                  
                        </div>
                        <div className="row">
                          <div className="col-sm-3 text-right">
                            <label className="pt-label label-margin">
                              Returned Value(s)
                            </label>
                          </div>
                          <div className="col-sm-9 smd-pad-4">
                            { this.props.methodCallModal.result[0].data.contents.length > 0 ?

                              <pre className='smd-scrollable'>
                                {JSON.stringify(this.props.methodCallModal.result[0].data.contents, null, 2)}
                              </pre>
                              : "No Returned Values"
                            }
                          </div>                  
                        </div>
                        <div className="row">
                          <div className="col-sm-3 text-right">
                            <label className="pt-label label-margin">
                              Block Hash
                            </label>
                          </div>
                          <div className="col-sm-9 smd-pad-4">
                            <HexText value={this.props.methodCallModal.result[0].txResult.blockHash} />
                          </div>                  
                        </div>
                      </div>
                    }
                  </div>
                  </div>
              </div>
              }
            </div>
            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button text="Cancel" onClick={this.handleCloseModal} />
                <button
                  className="pt-button pt-intent-primary"
                  type="button"
                  onClick={handleSubmit(this.submit)}
                >
                  Call Method
                </button>
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

  Object.getOwnPropertyNames(values).forEach((val) => {
    if (values[val] === '' || values[val] === undefined) {
      errors[val] = val + " Required";
    }
  });
  return errors
};

const selector = formValueSelector('contract-method-call');

export function mapStateToProps(state, ownProps) {
  return {
    contractInfo: state.contractCard.contractInfos
      && state.contractCard.contractInfos[ownProps.contractKey] ?
      state.contractCard.contractInfos[ownProps.contractKey] : {},
    methodCallModal: state.methodCall.modals
      && state.methodCall.modals[ownProps.methodKey] ?
      state.methodCall.modals[ownProps.methodKey] : {},
    accounts: state.accounts.accounts,
    modalUsername: selector(state, 'modalUsername'),
    chainLabel: state.chains.listChain,
    chainLabelIds: state.chains.listLabelIds,
    oAuthUser: state.user.oauthUser,
    userCertificate: state.user.userCertificate,
    selectedChain: state.chains.selectedChain,
  };
}


const formed = reduxForm({ form: 'contract-method-call', validate })(ContractMethodCall);
const connected = connect(
  mapStateToProps,
  {
    methodCall,
    fetchChainIds,
    getLabelIds
  }
)(formed);
const routed = withRouter(connected);

export default routed;
