import React, {Component} from 'react';
import {
  sendEtherOpenModal,
  sendEtherCloseModal,
  sendEther,
  fromUsernameChange,
  toUsernameChange
} from './sendEther.actions';
import {fetchAccounts} from '../../accounts.actions';
import {Button, Dialog} from '@blueprintjs/core';
import {Field, reduxForm, formValueSelector} from 'redux-form';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import ValueInput from '../../../ValueInput';

// TODO: use solc instead of extabi for compile

class CreateContract extends Component {

  // handleFromUsernameChange = (e) => {
  //   this.props.fromUsernameChange(e.target.value);
  // };
  //
  // handleToUsernameChange = (e) => {
  //   this.props.toUsernameChange(e.target.value);
  // };

  submit = (values) => {
      const payload = {
        from: values.from,
        fromAddress: values.fromAddress,
        password: values.password,
        to: values.to,
        toAddress: values.toAddress,
        value: values.value
      };
      this.props.sendEther(payload);
      mixpanelWrapper.track('send_ether_submit_click_successful');
      this.props.reset();
  };

  componentDidMount() {
    mixpanelWrapper.track("send_ether_loaded");
    this.props.fetchAccounts();
  }

  componentWillReceiveProps(newProps) {
    if (this.props.isOpen !== newProps.isOpen) {
      this.props.fetchAccounts();
    }
  }

  render() {
    const {handleSubmit, pristine, submitting} = this.props;
    const users = Object.getOwnPropertyNames(this.props.accounts);

    const fromUserAddresses = this.props.accounts && this.props.fromUsername ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.fromUsername])
      : [];

    const toUserAddresses = this.props.accounts && this.props.toUsername ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.toUsername])
      : [];

    return (
      <div className="smd-pad-16">
        <Button onClick={() => {
          mixpanelWrapper.track("send_ether_open_click");
          this.props.sendEtherOpenModal()
        }} className="pt-intent-primary pt-icon-add"
                text="Send Ether"/>
        <form>
          <Dialog
            iconName="inbox"
            isOpen={this.props.isOpen}
            onClose={this.props.sendEtherCloseModal}
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
                      // onChange={this.handleFromUsernameChange}
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
                    >
                      <option />
                      {
                        fromUserAddresses ?
                          fromUserAddresses.map((address, i) => {
                            return (
                              <option key={address} value={address}>{address}</option>
                            )
                          })
                          : ''
                      }
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
                      // onChange={this.handleToUsernameChange}
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
              </div>
              <div className="row">
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
                        toUserAddresses ?
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
              </div>

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
                    {this.props.result} <br/>
                  </pre>
                </div>
              </div>
            </div>

            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button text="Cancel" onClick={() => {
                  mixpanelWrapper.track("send_ether_cancel");
                  this.props.sendEtherCloseModal()
                  this.props.fetchAccounts()
                }}/>
                <Button
                  className={this.props.createDisabled ? "pt-disabled" : "pt-intent-primary"}
                  onClick={handleSubmit(this.submit)}
                  disabled={pristine || submitting}
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

function mapStateToProps(state) {
  return {
    isOpen: state.sendEther.isOpen,
    result: state.sendEther.result,
    accounts: state.accounts.accounts,
    fromUsername: selector(state, 'from'),
    toUsername: selector(state, 'to')
  };
}

const formed = reduxForm({form: 'send-ether'})(CreateContract);
const connected = connect(mapStateToProps, {
  sendEtherOpenModal,
  sendEtherCloseModal,
  sendEther,
  fetchAccounts,
  fromUsernameChange,
  toUsernameChange
})(formed);

export default withRouter(connected);
