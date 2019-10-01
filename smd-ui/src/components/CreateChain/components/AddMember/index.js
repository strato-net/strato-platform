import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button, Dialog, Intent } from '@blueprintjs/core';

import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import { Field, reduxForm } from 'redux-form';
import { fetchAccounts, fetchUserAddresses } from '../../../Accounts/accounts.actions';
import { openAddMemberModal, closeAddMemberModal } from '../../createChain.actions';
import { validate } from './validate';
import { isOauthEnabled } from '../../../../lib/checkMode';

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

  userNameField = (users, isModeOauth) => {
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

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  submit = () => {
    let data = {
      username: isOauthEnabled() ? this.props.initialValues.from : this.state.username,
      address: isOauthEnabled() ? this.props.initialValues.fromAddress : this.state.address,
      enode: this.state.enode,
      balance: this.state.balance
    }

    let errors = validate(data, this.state.form.userSelected);
    this.setState({ errors });

    if (!Object.values(errors).length) {
      mixpanelWrapper.track('add_member_submit_click_successful');
      this.props.handler(data);
      this.props.reset();
      this.closeModal();
    }
  }

  render() {
    const users = Object.getOwnPropertyNames(this.props.accounts);
    const isModeOauth = isOauthEnabled();

    return (
      <div >
        <Button onClick={() => {
          mixpanelWrapper.track("add_member_open_click");
          this.setState({ username: null, address: null, balance: 0, enode: null });
          this.props.openAddMemberModal();
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
          <form>
            <div className="pt-dialog-body">

              {
                !isModeOauth &&
                <div className="row">
                  <div className="col-sm-3 text-right" />
                  <div className="col-sm-9 smd-pad-4">
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
                            return {
                              form: { userSelected: !prevState.form.userSelected },
                              username: null,
                              address: null,
                              balance: 0,
                              enode: null,
                              errors: null
                            };
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
                            return {
                              form: { userSelected: !prevState.form.userSelected },
                              username: null,
                              address: null,
                              balance: 0,
                              enode: null,
                              errors: null
                            };
                          });
                        }
                      }
                    /> Address
                  </div>
                </div>
              }

              {
                this.state.form.userSelected &&
                <div>
                  <div className="row">
                    <div className="col-sm-3 text-right">
                      <label className="pt-label smd-pad-4">
                        Username
                  </label>
                    </div>
                    <div className="col-sm-9 smd-pad-4">
                      <div className="pt-select">
                        {this.userNameField(users, isModeOauth)}
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
                        {this.addressField(isModeOauth)}
                        <br /><span className="error-text">{this.errorMessageFor('address')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              }

              {
                !this.state.form.userSelected &&
                <div className="row">
                  <div className="col-sm-3 text-right">
                    <label className="pt-label smd-pad-4">
                      Address
                  </label>
                  </div>
                  <div className="col-sm-9 smd-pad-4">
                    <Field
                      id="address"
                      className="form-width pt-input"
                      placeholder="address"
                      name="address"
                      component="input"
                      dir="auto"
                      title="address"
                      onChange={(e) => this.handleAddressChange(e)}
                      required
                    />
                    <br /><span className="error-text">{this.errorMessageFor('address')}</span>
                  </div>
                </div>
              }

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
                  this.props.reset();
                  this.closeModal();
                }} />
                <Button
                  intent={Intent.PRIMARY}
                  onClick={this.submit}
                  text="Add Member"
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
    isOpen: state.createChain.isAddMemberModalOpen,
    accounts: state.accounts.accounts,
    initialValues: {
      from: state.user.oauthUser ? state.user.oauthUser.username : '',
      fromAddress: state.user.oauthUser ? state.user.oauthUser.address : ''
    }
  };
}

const formed = reduxForm({ form: 'add-member' })(AddMember);
const connected = connect(mapStateToProps, {
  fetchAccounts,
  fetchUserAddresses,
  openAddMemberModal,
  closeAddMemberModal
})(formed);

export default withRouter(connected);
