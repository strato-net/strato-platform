import React, { Component } from 'react';
import {
  sendEtherOpenModal,
  sendEtherCloseModal,
  sendEther,
  fromUsernameChange,
  toUsernameChange
} from './sendEther.actions';
import { fetchAccounts, fetchUserAddresses } from '../../accounts.actions';
import { Button, Dialog } from '@blueprintjs/core';
import { Field, reduxForm, formValueSelector } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import ValueInput from '../../../ValueInput';
import validate from './validate';

// TODO: use solc instead of extabi for compile

class SendEther extends Component {

  // handleFromUsernameChange = (e) => {
  //   this.props.fromUsernameChange(e.target.value);
  // };
  //
  // handleToUsernameChange = (e) => {
  //   this.props.toUsernameChange(e.target.value);
  // };

  constructor(props) {
    super(props)
    this.state = {
      form: {
        userSelected: true
      }
    }
  }

  closeModal = () => {
    this.props.sendEtherCloseModal();
    this.props.fetchAccounts(true, true);
  }

  submit = (values) => {
    const toAddress = this.state.form.userSelected ? values.toAddress : values.address
    const payload = {
      from: values.from,
      fromAddress: values.fromAddress,
      password: values.password,
      toAddress: toAddress,
      value: values.value
    };

    this.props.sendEther(payload);
    mixpanelWrapper.track('send_ether_submit_click_successful');
    this.props.reset();
  };

  componentDidMount() {
    mixpanelWrapper.track("send_ether_loaded");
  }

  render() {
    const { handleSubmit, pristine, submitting, valid } = this.props;
    const users = Object.getOwnPropertyNames(this.props.accounts);

    // const fromUserAddresses = this.props.accounts && this.props.fromUsername ?
    //   Object.getOwnPropertyNames(this.props.accounts[this.props.fromUsername])
    //   : [];

    const toUserAddresses = this.props.accounts && this.props.toUsername ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.toUsername])
      : [];

    return (
      <div className="smd-pad-16">
        <Button onClick={() => {
          mixpanelWrapper.track("send_ether_open_click");
          this.props.sendEtherOpenModal()
        }} className="pt-intent-primary pt-icon-add"
          text="Send Tokens" />
        <form>
          <Dialog
            iconName="inbox"
            isOpen={this.props.isOpen}
            onClose={this.closeModal}
            title="Send Ether"
            style={{
              width: "560px"
            }}
            className="pt-dark"
          >
            <div className="pt-dialog-body">
              <div className="row">
                <div className="col-sm-4 text-right">
                  <label className="pt-label smd-pad-4">
                    From
                  </label>
                </div>
                <div className="col-sm-8 smd-pad-4">
                  <div className="pt-select">
                    <Field
                      className="pt-input"
                      component="select"
                      name="from"
                      onChange={
                        (e) => this.props.fetchUserAddresses(e.target.value, true)
                      }
                      required
                      disabled
                    >
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
              </div>
              <div className="row">
                <div className="col-sm-4 text-right">
                  <label className="pt-label smd-pad-4">
                    From Address
                  </label>
                </div>
                <div className="col-sm-8 smd-pad-4">
                  <div className="pt-select">
                    <Field
                      className="pt-input"
                      component="select"
                      name="fromAddress"
                      required
                      disabled
                    >
                      <option value={this.props.initialValues.fromAddress}>{this.props.initialValues.fromAddress}</option>
                      {/*
                        fromUserAddresses.length ?
                          fromUserAddresses.map((address, i) => {
                            return (
                              <option key={address} value={address}>{address}</option>
                            )
                          })
                          : ''
                      */}
                    </Field>
                  </div>
                </div>
              </div>
              <div className="row">
                <div className="col-sm-4 text-right">
                  <label className="pt-label smd-pad-4">
                    Password
                  </label>
                </div>
                <div className="col-sm-8 smd-pad-4">
                  <Field
                    id="input-b"
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
              </div>

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
                    id="input-b"
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
                  className={this.props.createDisabled ? "pt-disabled" : "pt-intent-primary"}
                  onClick={handleSubmit(this.submit)}
                  disabled={pristine || submitting || !valid}
                  text="Send Ether"
                />
              </div>
            </div>
          </Dialog>
        </form>
      </div>
    );
  }
}

const selector = formValueSelector('send-ether');

export function mapStateToProps(state) {
  return {
    isOpen: state.sendEther.isOpen,
    result: state.sendEther.result,
    accounts: state.accounts.accounts,
    fromUsername: selector(state, 'from'),
    toUsername: selector(state, 'to'),
    initialValues: {
      from: state.user.currentUser.username,
      fromAddress: state.user.currentUser.address
    }
  };
}

const formed = reduxForm({ form: 'send-ether', validate })(SendEther);
const connected = connect(mapStateToProps, {
  sendEtherOpenModal,
  sendEtherCloseModal,
  sendEther,
  fetchAccounts,
  fetchUserAddresses,
  fromUsernameChange,
  toUsernameChange
})(formed);

export default withRouter(connected);
