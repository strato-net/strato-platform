import React, { Component } from 'react';
import {
  sendTokensOpenModal,
  sendTokensCloseModal,
  sendTokens,
  fromUsernameChange,
  toUsernameChange
} from '../../../Accounts/components/SendTokens/sendTokens.actions';
import { fetchAccounts, fetchUserAddresses, fetchBalanceRequest } from '../../../Accounts/accounts.actions';
import { Button, Dialog } from '@blueprintjs/core';
import { Field, reduxForm, formValueSelector } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import validate from '../../../Accounts/components/SendTokens/validate';
import { isModePublic } from '../../../../lib/checkMode';

class AddMember extends Component {

  constructor(props) {
    super(props)
    this.state = {
      form: {
        userSelected: true
      },
      username: '',
      address: '',
      enode: '',
      balance: 0
    }
  }

  closeModal = () => {
    this.props.sendTokensCloseModal();
    !isModePublic() && this.props.fetchAccounts(true, true);
  }

  componentDidMount() {
    mixpanelWrapper.track("add_member_loaded");
    this.props.fetchAccounts(true, true);
  }

  handleUsernameChange(event) {
    this.setState({
      username: event.target.value
    });
  }

  handleAddressChange(event) {
    this.setState({
      address: event.target.value
    });
  }

  handleEnodeChange(event) {
    this.setState({
      enode: event.target.value
    });
  }

  handleBalanceChange(event) {
    this.setState({
      balance: event.target.value
    });
  }

  userNameField = (users, isPublicMode) => {
    return (
      <Field
        className="pt-input"
        component="select"
        name="from"
        value={this.state.username}
        onChange={
          (e) => {
            this.props.fetchUserAddresses(e.target.value, true);
            this.handleUsernameChange(e);
          }
        }
        required
        disabled={isPublicMode}
      >
        {isPublicMode && <option value={isPublicMode ? this.props.initialValues.from : null}>{this.props.initialValues.from}</option>}
        {!isPublicMode && <option />}
        {
          !isPublicMode && users.map((user, i) => {
            return (
              <option key={'user' + i} value={user}>{user}</option>
            )
          })
        }
      </Field>
    )
  }

  addressField = (isPublicMode) => {
    const fromUserAddresses = Object.keys(this.props.accounts).length && this.props.fromUsername ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.fromUsername])
      : [];

    return (
      <Field
        className="pt-input"
        component="select"
        name="fromAddress"
        value={this.state.address}
        onChange={(e) => this.handleAddressChange(e)}
        required
        disabled={isPublicMode}
      >
        <option value={isPublicMode ? this.props.initialValues.fromAddress : null}>{this.props.initialValues.fromAddress}</option>
        {
          (!isPublicMode && fromUserAddresses.length) ?
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

  render() {
    const users = Object.getOwnPropertyNames(this.props.accounts);
    const isPublicMode = isModePublic();

    return (
      <div >
        <Button onClick={() => {
          mixpanelWrapper.track("add_member_open_click");
          isModePublic() && this.props.fetchBalanceRequest(this.props.initialValues.fromAddress);
          this.props.sendTokensOpenModal()
        }} className="pt-intent-primary pt-icon-add"
          text="Add Member" />
        <form>
          <Dialog
            iconName="inbox"
            isOpen={this.props.isOpen}
            onClose={this.closeModal}
            title="Add Member"
            style={{
              width: "560px"
            }}
            className="pt-dark"
          >
            <div className="pt-dialog-body">

              <div className="row">
                <div className="col-sm-4 text-right">
                  <label className="pt-label smd-pad-4">
                    Username
                  </label>
                </div>
                <div className="col-sm-8 smd-pad-4">
                  <div className="pt-select">
                    {this.userNameField(users, isPublicMode)}
                  </div>
                </div>
              </div>

              <div className="row">
                <div className="col-sm-4 text-right">
                  <label className="pt-label smd-pad-4">
                    Address
                  </label>
                </div>
                <div className="col-sm-8 smd-pad-4">
                  <div className="pt-select">
                    {this.addressField(isPublicMode)}
                  </div>
                </div>
              </div>

              <div className="row">
                <div className="col-sm-4 text-right">
                  <label className="pt-label smd-pad-4">
                    Enode
                  </label>
                </div>
                <div className="col-sm-8 smd-pad-4">
                  <div className="form-width">
                    <Field
                      name="enode"
                      component="input"
                      type="text"
                      placeholder="Enode"
                      value={this.state.enode}
                      className="pt-input form-width"
                      onChange={(e) => this.handleEnodeChange(e)}
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="row">
                <div className="col-sm-4 text-right">
                  <label className="pt-label smd-pad-4">
                    Balance
                  </label>
                </div>
                <div className="col-sm-8 smd-pad-4">
                  <div className="form-width">
                    <Field
                      name="value"
                      component="input"
                      type="number"
                      placeholder="Balance"
                      value={this.state.balance}
                      className="pt-input form-width"
                      onChange={(e) => this.handleBalanceChange(e)}
                      required
                    />
                  </div>
                </div>
              </div>

            </div>

            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button text="Cancel" onClick={() => {
                  mixpanelWrapper.track("add_member_cancel");
                  this.closeModal();
                }} />
                <Button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.props.handler(this.state);
                    mixpanelWrapper.track('add_member_submit_click_successful');
                    this.closeModal();
                  }}
                  text="Add Member"
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
      from: state.user.currentUser.username,
      fromAddress: state.user.currentUser.accountAddress
    },
    balance: state.accounts.currentUserBalance
  };
}

const formed = reduxForm({ form: 'send-tokens', validate })(AddMember);
const connected = connect(mapStateToProps, {
  sendTokensOpenModal,
  sendTokensCloseModal,
  sendTokens,
  fetchAccounts,
  fetchUserAddresses,
  fromUsernameChange,
  toUsernameChange,
  fetchBalanceRequest
})(formed);

export default withRouter(connected);
