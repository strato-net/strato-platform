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
      orgName: ``,
      orgUnit: ``,
      commonName: ``,
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

  // handleAddressChange(event) {
  //   this.setState({
  //     address: event.target.value
  //   });
  // }

  handleOrgNameChange(event) {
    this.setState({
      orgName: event.target.value
    });
  }

  handleOrgUnitChange(event) {
    this.setState({
      orgUnit: event.target.value
    });
  }

  handleCommonNameChange(event) {
    this.setState({
      commonName: event.target.value
    });
  }

  handleAccessChange(event) {
    this.setState({
      access: event.target.value
    });
  }

  // handleEnodeChange(event) {
  //   this.setState({
  //     enode: event.target.value
  //   });
  // }

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
      orgName: this.state.orgName,
      orgUnit: this.state.orgUnit,
      commonName: this.state.commonName,
      access: this.state.access,
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
                              orgName: ``,
                              balance: 0,
                              orgUnit: '',
                              commonName: '',
                              access: '',
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
                              orgName: '',
                              orgUnit: '',
                              balance: 0,
                              commonName: ``,
                              access: '',
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

                  {/* <div className="row">
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
                  </div> */}
                </div>
              }

              {
                // !this.state.form.userSelected &&
                <div className="row">
                  <div className="col-sm-3 text-right">
                    <label className="pt-label smd-pad-4">
                      Org Name:
                  </label>
                  </div>
                  <div className="col-sm-9 smd-pad-4">
                    <Field
                      id="orgName"
                      className="form-width pt-input"
                      placeholder="Org Name"
                      name="orgName"
                      component="input"
                      dir="auto"
                      title="orgName"
                      onChange={(e) => this.handleOrgNameChange(e)}
                      required
                    />
                    <br /><span className="error-text">{this.errorMessageFor('orgName')}</span>
                  </div>
                </div>
              }

              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Org Unit:
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <div className="form-width">
                    <Field
                      name="orgUnit"
                      component="input"
                      type="text"
                      placeholder="Org Unit"
                      value={this.state.orgUnit}
                      className="pt-input form-width"
                      onChange={(e) => this.handleOrgUnitChange(e)}
                      required
                    />
                    <br /><span className="error-text">{this.errorMessageFor('orgUnit')}</span>
                  </div>
                </div>
              </div>

              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Common Name:
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <div className="form-width">
                    <Field
                      name="commonName"
                      component="input"
                      type="text"
                      placeholder="Common Name"
                      value={this.state.commonName}
                      className="pt-input form-width"
                      onChange={(e) => this.handleCommonNameChange(e)}
                      required
                    />
                    <br /><span className="error-text">{this.errorMessageFor('commonName')}</span>
                  </div>
                </div>
              </div>

              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Access
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <div className="form-width">
                  <Field
                      style={{ marginLeft: 25 }}
                      name="radio"
                      component="input"
                      type="radio"
                      value={true}
                      label='Add'
                      checked={this.state.access === true}
                      onClick={() => {
                        this.setState((prevState) => {
                          return {access:true };
                        });
                      }}
                    /> Add
                  <Field
                      style={{ marginLeft: 25 }}
                      name="radio"
                      component="input"
                      type="radio"
                      value={false}
                      label='Remove'
                      checked={this.state.access === false}
                      onClick={() => {
                        this.setState((prevState) => {
                          return {access:false };
                        });
                      }}
                    /> Remove
                    <br /><span className="error-text">{this.errorMessageFor('access')}</span>
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
      orgName: "",
      orgUnit: "",
      commonName: ""
      // enode : `enode://${state.user.publicKey}@1.2.3.4:30303`
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
