import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button, Dialog, Intent } from '@blueprintjs/core';

import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import { Field } from 'redux-form';
import { fetchAccounts, fetchUserAddresses } from '../../../Accounts/accounts.actions';
import { openAddMemberModal, closeAddMemberModal } from '../../createChain.actions';
import { isModePublic } from '../../../../lib/checkMode';
import { validate } from './validate';

class AddMember extends Component {

  constructor(props) {
    super(props)
    this.state = {
      form: {
        userSelected: true
      },
      username: null,
      address: null,
      enode: null,
      balance: 0,
      errors: null
    }
  }

  closeModal = () => {
    this.props.closeAddMemberModal();
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
            this.props.fetchUserAddresses(e.target.value, false);
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
    const fromUserAddresses = Object.keys(this.props.accounts).length && this.state.username ?
      Object.getOwnPropertyNames(this.props.accounts[this.state.username])
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

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  submit = () => {
    let data = {
      username: isModePublic() ? this.props.initialValues.from : this.state.username,
      address: isModePublic() ? this.props.initialValues.fromAddress : this.state.address,
      enode: this.state.enode,
      balance: this.state.balance
    }

    let errors = validate(data);
    this.setState({ errors });

    if (!Object.values(errors).length) {
      mixpanelWrapper.track('add_member_submit_click_successful');
      this.props.handler(data);
      this.closeModal();
    }
  }

  render() {
    const users = Object.getOwnPropertyNames(this.props.accounts);
    const isPublicMode = isModePublic();

    return (
      <div >
        <Button onClick={() => {
          mixpanelWrapper.track("add_member_open_click");
          this.props.openAddMemberModal()
        }} className="pt-intent-primary pt-icon-add"
          style={{ marginTop: '8px' }}
          text="Add Member" />

        <Dialog
          iconName="add"
          isOpen={this.props.isOpen}
          onClose={this.closeModal}
          title="Add Member"
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
                  {this.userNameField(users, isPublicMode)}
                  <br /><span className="error-text">{this.errorMessageFor('username')}</span>
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
                  {this.addressField(isPublicMode)}
                  <br /><span className="error-text">{this.errorMessageFor('address')}</span>
                </div>
              </div>
            </div>

            <div className="row">
              <div className="col-sm-3 text-right">
                <label className="pt-label smd-pad-4">
                  Enode
                  </label>
              </div>
              <div className="col-sm-9 smd-pad-4">
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
                  <br /><span className="error-text">{this.errorMessageFor('enode')}</span>
                </div>
              </div>
            </div>

            <div className="row">
              <div className="col-sm-3 text-right">
                <label className="pt-label smd-pad-4">
                  Balance
                  </label>
              </div>
              <div className="col-sm-9 smd-pad-4">
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
                intent={Intent.PRIMARY}
                onClick={this.submit}
                text="Add Member"
              />
            </div>
          </div>
        </Dialog>
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    isOpen: state.createChain.isAddMemberModalOpen,
    accounts: state.accounts.accounts,
    initialValues: {
      from: state.user.currentUser.username,
      fromAddress: state.user.currentUser.accountAddress
    }
  };
}

const connected = connect(mapStateToProps, {
  fetchAccounts,
  fetchUserAddresses,
  openAddMemberModal,
  closeAddMemberModal
})(AddMember);

export default withRouter(connected);
