import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter, Link } from 'react-router-dom';
import { Field, reduxForm } from 'redux-form';
import Dropzone from 'react-dropzone';
import { required } from '../../lib/reduxFormsValidations'

import {
  loadLaunchPad,
  usernameChange
} from './launchPad.actions';
import { fetchAccounts } from '../Accounts/accounts.actions';

class LaunchPad extends Component {

  componentWillMount() {
    if(this.props.launchPad.firstLoad) {
      if(Object.getOwnPropertyNames(this.props.accounts).length === 0) {
        this.props.fetchAccounts();
      }
      this.props.loadLaunchPad();
    }
  }

  renderDropzoneInput = (field) => {
    const touchedAndHasErrors = field.meta.touched && field.meta.error
    return (
      <div className="dropzoneContainer text-center">
        <Dropzone
          className={ touchedAndHasErrors ? "dropzone" : "dropzoneActive"}
          activeClassName="dropzoneActive"
          rejectClassName="dropzoneRejected"
          name={field.name}
        >
          <p style={{'float': 'left'}}>Drop the package here or click to browse</p>
        </Dropzone>
        {touchedAndHasErrors && <span className="error">{field.meta.error}</span>}
      </div>
    );
  };

  handleUsernameChange = (e) => {
    this.props.usernameChange(e.target.value);
  };

  submit = (values) => {

  };

  render() {
    const {handleSubmit, pristine, submitting, valid} = this.props;
    const users = Object.getOwnPropertyNames(this.props.accounts);
    const userAddresses = this.props.accounts && this.props.launchPad.username ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.launchPad.username])
      : null;

    return (
      <div className="container-fluid pt-dark">
        <div className="row smd-pad-12">
          <div className="col-sm-10">
            <h3>Launchpad</h3>
          </div>
          <div className="col-sm-2 text-right smd-pad-vertical-12">
            <Link to="/apps">
              <button
                type="button"
                className="pt-button pt-intent-primary"
              >
                Apps
              </button>
            </Link>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <div className="pt-card">
              <h4>Enter application details</h4>
              <hr />
              <form>
                <div className="row smd-pad-top-12">
                  <div className="col-sm-2 text-right">
                    <label className="pt-label smd-pad-vertical-4" htmlFor="appName">
                      Username
                    </label>
                  </div>
                  <div className="col-sm-10">
                    <div className="pt-select">
                      <Field
                        className="pt-input"
                        component="select"
                        name="appUsername"
                        onChange={this.handleUsernameChange}
                        validate={required}
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
                  <div className="col-sm-2 text-right">
                    <label className="pt-label smd-pad-vertical-4" htmlFor="appName">
                      User Address
                    </label>
                  </div>
                  <div className="col-sm-10">
                    <div className="pt-select">
                      <Field
                        className="pt-input"
                        component="select"
                        name="appUserAddress"
                        validate={required}
                        required
                      >
                        <option />
                        {
                          userAddresses ?
                            userAddresses.map((address, i) => {
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
                  <div className="col-sm-2 text-right">
                    <label className="pt-label smd-pad-vertical-4" htmlFor="appName">
                      Password
                    </label>
                  </div>
                  <div className="col-sm-10">
                    <Field
                      name="appPassword"
                      className="pt-input smd-input-width"
                      component="input"
                      type="password"
                      placeholder="User Password"
                      dir="auto"
                      required
                    />
                  </div>
                </div>
                <div className="row">
                  <div className="col-sm-2 text-right">
                    <label className="pt-label smd-pad-vertical-4" htmlFor="appName">
                      Package
                    </label>
                  </div>
                  <div className="col-sm-10">
                    <Field
                      className="pt-input"
                      name="appPackage"
                      component={this.renderDropzoneInput}
                      dir="auto"
                      title="Package"
                      required
                    />
                  </div>
                </div>
                <div className="row">
                  <div className="col-sm-offset-2 col-sm-10">
                    <button
                      type="submit"
                      onClick={handleSubmit(this.submit)}
                      className="pt-button pt-intent-primary"
                      disabled={pristine || submitting || !valid}
                    >
                      Upload
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

}

function validate (values) {
  const errors = {};
  if (!values.appUsername) {
    errors.appUsername = "Username required";
  }
  if (!values.appUserAddress) {
    errors.appUserAddress = "User address required";
  }
  if (!values.appPassword) {
    errors.appPassword = "Password required";
  }
  // TODO: check file
  return errors;
}

function mapStateToProps(state) {
  return {
    accounts: state.accounts.accounts,
    launchPad: state.launchPad
  };
}

const CREATE_APP_FORM = 'create-app';

const formed = reduxForm({form:CREATE_APP_FORM, validate})(LaunchPad);

export default withRouter(
  connect( mapStateToProps,
    {
      usernameChange,
      loadLaunchPad,
      fetchAccounts,
    }
  )(formed)
);
