import React, { Component } from 'react';
import {
  sendTokensOpenModal,
  sendTokensCloseModal,
  sendTokens,
  fromUsernameChange,
  toUsernameChange
} from './sendTokens.actions';
import { fetchAccounts, fetchUserAddresses, fetchBalanceRequest } from '../../accounts.actions';
import { Button, Dialog, AnchorButton, Popover, PopoverInteractionKind, Position } from '@blueprintjs/core';
import { Field, reduxForm, formValueSelector } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import ValueInput from '../../../ValueInput';
import validate from './validate';
import { fetchChainIds, getLabelIds } from '../../../Chains/chains.actions';
import { isOauthEnabled } from '../../../../lib/checkMode';

// TODO: use solc instead of /contracts/xabi for compile

class SendTokens extends Component {

  constructor(props) {
    super(props)
    this.state = {
      form: {
        userSelected: true
      }
    }
  }

  closeModal = () => {
    this.props.sendTokensCloseModal();
    // TODO: Remove this public mode feature
    !isOauthEnabled() && this.props.fetchAccounts(true, true);
  }

  submit = (values) => {
    const toAddress = isOauthEnabled() ? values.address : (this.state.form.userSelected ? values.toAddress : values.address)

    const payload = {
      from: values.from,
      fromAddress: values.fromAddress,
      password: isOauthEnabled() ? '' : values.password,
      toAddress: toAddress,
      value: values.value,
      chainId: values.chainId
    };

    // For non-oauth enabled
    this.props.sendTokens(payload);

    mixpanelWrapper.track('send_ether_submit_click_successful');
    this.props.reset();
  };

  componentDidMount() {
    mixpanelWrapper.track("send_ether_loaded");
  }

  userNameField = (users, isModeOauth) => {
    return (
      <Field
        className="pt-input"
        component="select"
        name="from"
        onChange={
          (e) => this.props.fetchUserAddresses(e.target.value, true)
        }
        required
        disabled={isModeOauth}
      >
        {isModeOauth && <option value={isModeOauth ? this.props.initialValues.from : null}>{this.props.initialValues.from}</option>}
        {!isModeOauth && <option />}
        {
          !isModeOauth && users.map((user, i) => {
            return (
              <option key={'user' + i} value={user}>{user}</option>
            )
          })
        }
      </Field>
    )
  }

  addressField = (isModeOauth) => {
    const fromUserAddresses = Object.keys(this.props.accounts).length && this.props.fromUsername ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.fromUsername])
      : [];

    return (
      <Field
        className="pt-input"
        component="select"
        name="fromAddress"
        required
        disabled={isModeOauth}
      >
        <option value={isModeOauth ? this.props.initialValues.fromAddress : null}>{this.props.initialValues.fromAddress}</option>
        {
          (!isModeOauth && fromUserAddresses.length) ?
            fromUserAddresses.map((address, i) => {
              return (
                <option key={address} value={address}>{address}</option>
              )
            })
            : ''
        }
      </Field>
    )
  }

  checkMode = (isModeOauth, users, toUserAddresses) => {
    if (isModeOauth) {
      return (<div className="row">
        <div className="col-sm-4 text-right">
          <label className="pt-label smd-pad-4">
            Address
            </label>
        </div>
        <div className="col-sm-8 smd-pad-4">
          <Field
            id="address"
            className="form-width pt-input"
            placeholder="address"
            name="address"
            component="input"
            dir="auto"
            title="address"
            required
          />
        </div>
      </div>)
    } else {
      return (
        <div>
          <div className="row">
            <div className="col-sm-4 text-right" />
            <div className="col-sm-8 smd-pad-4">
              <Field
                name="radio"
                component="input"
                type="radio"
                value={0}
                label='User'
                checked={this.state.form.userSelected}
                onClick={
                  () => {
                    this.setState((prevState) => {
                      return { form: { userSelected: !prevState.form.userSelected } };
                    });
                  }
                }
              /> User
                    <Field
                style={{ marginLeft: 25 }}
                name="radio"
                component="input"
                type="radio"
                value={1}
                label='Address'
                checked={!this.state.form.userSelected}
                onClick={
                  () => {
                    this.setState((prevState) => {
                      return { form: { userSelected: !prevState.form.userSelected } };
                    });
                  }
                }
              /> Address
            </div>
          </div>


          {!this.state.form.userSelected && <div className="row">
            <div className="col-sm-4 text-right">
              <label className="pt-label smd-pad-4">
                Address
                  </label>
            </div>
            <div className="col-sm-8 smd-pad-4">
              <Field
                id="address"
                className="form-width pt-input"
                placeholder="address"
                name="address"
                component="input"
                dir="auto"
                title="address"
                required
              />
            </div>
          </div>}



          {this.state.form.userSelected && <div className="row">
            <div className="col-sm-4 text-right">
              <label className="pt-label smd-pad-4">
                To
                  </label>
            </div>
            <div className="col-sm-8 smd-pad-4">
              <div className="pt-select">
                <Field
                  className="pt-input"
                  component="select"
                  name="to"
                  onChange={
                    (e) => this.props.fetchUserAddresses(e.target.value, true)
                  }
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
          </div>}



          {this.state.form.userSelected && <div className="row">
            <div className="col-sm-4 text-right">
              <label className="pt-label smd-pad-4">
                To Address
                  </label>
            </div>
            <div className="col-sm-8 smd-pad-4">
              <div className="pt-select">
                <Field
                  className="pt-input"
                  component="select"
                  name="toAddress"
                  required
                >
                  <option />
                  {
                    toUserAddresses.length ?
                      toUserAddresses.map((address, i) => {
                        return (
                          <option key={address} value={address}>{address}</option>
                        )
                      })
                      : ''
                  }
                </Field>
              </div>
            </div>
          </div>}
        </div >)

    }
  }

  renderChainFields() {
    const chainLabel = Object.getOwnPropertyNames(this.props.chainLabel);

    if (chainLabel.length) {
      return (
        <div>
          <div className="row">
            <div className="col-sm-4 text-right">
              <label className="pt-label smd-pad-4">
                Shard
              </label>
            </div>
            <div className="col-sm-8 smd-pad-4">
              <div className="pt-select">
                <Field
                  className="pt-input chain-field"
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
            <div className="col-sm-4 text-right">
              <label className="pt-label smd-pad-4">
                Shard IDs
              </label>
            </div>
            <div className="col-sm-8 smd-pad-4">
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

  render() {
    const { handleSubmit, pristine, submitting, valid } = this.props;
    const users = Object.getOwnPropertyNames(this.props.accounts);
    const isModeOauth = isOauthEnabled();

    const toUserAddresses = this.props.accounts && this.props.toUsername ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.toUsername])
      : [];
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
          <AnchorButton 
            onClick={() => {
              mixpanelWrapper.track("send_ether_open_click");
              // TODO: remove public mode
              isModeOauth && (this.props.initialValues.fromAddress != "Verification Pending") && this.props.fetchBalanceRequest(this.props.initialValues.fromAddress);
              this.props.fetchChainIds();
              this.props.sendTokensOpenModal();
              this.props.reset();
            }} 
            className="pt-intent-primary pt-icon-add"
            disabled={!this.props.userCertificate}
            text={"Send Tokens"} 
          />
        </Popover>
        <form>
          <Dialog
            iconName="inbox"
            isOpen={this.props.isOpen}
            onClose={this.closeModal}
            title="Send Tokens"
            style={{
              width: "560px"
            }}
            className="pt-dark send-tokens-dialog"
          >
            <div className="pt-dialog-body">
              {this.renderChainFields()}
              <div className="row">
                <div className="col-sm-4 text-right">
                  <label className="pt-label smd-pad-4">
                    From
                  </label>
                </div>
                <div className="col-sm-8 smd-pad-4">
                  <div className="pt-select">
                    {this.userNameField(users, isModeOauth)}
                  </div>
                </div>
              </div>
              <div className="row">
                <div className="col-sm-4 text-right">
                  <label className="pt-label smd-pad-4">
                    From Address
                  </label>
                </div>
                <div className="col-sm-8 smd-pad-4">
                  <div className="pt-select">
                    {this.addressField(isModeOauth)}
                  </div>
                </div>
              </div>
              {!isModeOauth && <div className="row">
                <div className="col-sm-4 text-right">
                  <label className="pt-label smd-pad-4">
                    Password
                  </label>
                </div>
                <div className="col-sm-8 smd-pad-4">
                  <Field
                    id="password"
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
              </div>}

              {this.checkMode(isModeOauth, users, toUserAddresses)}

              <div className="row">
                <div className="col-sm-4 text-right">
                  <label className="pt-label smd-pad-4">
                    Value
                  </label>
                </div>
                <div className="col-sm-8 smd-pad-4">
                  <div className="form-width">
                    <Field
                      name="value"
                      balance={this.props.balance}
                      component={ValueInput}
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="row">
                <div className="col-sm-12">
                  <hr />
                  <h5>Results</h5>
                  <pre className="smd-scrollable">
                    {this.props.result} <br />
                  </pre>
                </div>
              </div>
            </div>

            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button text="Cancel" onClick={() => {
                  mixpanelWrapper.track("send_ether_cancel");
                  this.closeModal();
                }} />
                <Button
                  onClick={handleSubmit(this.submit)}
                  disabled={pristine || submitting || !valid}
                  text="Send Tokens"
                />
              </div>
            </div>
          </Dialog>
        </form>
      </div>
    );
  }
}

const selector = formValueSelector('send-tokens');

export function mapStateToProps(state) {
  return {
    isOpen: state.sendTokens.isOpen,
    result: state.sendTokens.result,
    accounts: state.accounts.accounts,
    fromUsername: selector(state, 'from'),
    toUsername: selector(state, 'to'),
    initialValues: {
      from: state.user.oauthUser ? state.user.oauthUser.commonName : 'Certification Pending',
      fromAddress: state.user.oauthUser ? state.user.oauthUser.address : 'Certification Pending'
    },
    balance: state.accounts.currentUserBalance,
    chainLabel: state.chains.listChain,
    chainLabelIds: state.chains.listLabelIds,
    userCertificate: state.user.userCertificate,
  };
}

const formed = reduxForm({ form: 'send-tokens', validate })(SendTokens);
const connected = connect(mapStateToProps, {
  sendTokensOpenModal,
  sendTokensCloseModal,
  sendTokens,
  fetchAccounts,
  fetchUserAddresses,
  fromUsernameChange,
  toUsernameChange,
  fetchBalanceRequest,
  fetchChainIds,
  getLabelIds
})(formed);

export default withRouter(connected);
