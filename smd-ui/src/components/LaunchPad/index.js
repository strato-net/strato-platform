import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter, Link } from 'react-router-dom';
import { Field, reduxForm } from 'redux-form';
import Dropzone from 'react-dropzone';
import { Button } from '@blueprintjs/core';
import { required } from '../../lib/reduxFormsValidations'
import mixpanelWrapper from '../../lib/mixpanelWrapper';

import {
  loadLaunchPad,
  usernameChange,
  appUploadRequest,
  appSetError,
  appReset
} from './launchPad.actions';
import { fetchAccounts, fetchUserAddresses } from '../Accounts/accounts.actions';
import { canDeployApps } from '../../lib/envChecks';
import { isModePublic } from '../../lib/checkMode';

class LaunchPad extends Component {

  componentDidMount() {
    mixpanelWrapper.track('launchpad_deploy_load');
  }

  componentWillMount() {
    if (this.props.launchPad.firstLoad) {
      if (Object.getOwnPropertyNames(this.props.accounts).length === 0 && !isModePublic()) {
        this.props.fetchAccounts(true, false);
      }
      this.props.loadLaunchPad();
    }
  }

  handleFileDrop = (files, field, appSetError) => {
    if (files.length > 1) {
      appSetError('Expected a zip archive, got multiple files');
      return;
    }
    const regex = new RegExp(/.zip$/, 'i');
    if (!regex.test(files[0].name)) {
      appSetError(`Please upload a zip archive`);
      return;
    }
    appSetError('');
    field.input.onChange(files);
  }

  componentDidUpdate() {
    if (this.props.launchPad.requestCompleted) {
      this.props.appReset();
      this.props.history.push('/apps');
    }
  }

  componentWillUnmount() {
    this.props.appReset();
  }

  renderDropzoneInput = (field) => {
    const files = field.input.value;
    const appSetError = this.props.appSetError;
    return (
      <div className="dropzoneContainer text-center">
        <Dropzone
          className="dropzone"
          onDrop={(files, e) => { this.handleFileDrop(files, field, appSetError) }}
          name={field.name}
        >
          {({ isDragActive, isDragReject, acceptedFiles }) => {
            if (isDragActive) {
              return (<span>Drop to Upload!</span>);
            }
            return (
              files && Array.isArray(files) && files.length > 0
                ? (<span>{files[0].name}</span>)
                : (<span>Drop the package here or click to browse</span>)
            );
          }}
        </Dropzone>
      </div>
    );
  }

  handleUsernameChange = (e) => {
    this.props.usernameChange(e.target.value);
    this.props.fetchUserAddresses(e.target.value)
  }

  submit = (values) => {
    this.props.appUploadRequest(values);
    mixpanelWrapper.track('launchpad_upload_app');
  }

  renderUsername = (isPublicMode) => {
    const users = Object.getOwnPropertyNames(this.props.accounts);
    return (<div className={isPublicMode ? "" : "pt-select"}>
      <Field
        className="pt-input"
        component="select"
        name="appUsername"
        onChange={this.handleUsernameChange}
        validate={required}
        disabled={isPublicMode}
        required
      >
        <option value={isPublicMode ? this.props.currentUser.username : null}>
          {isPublicMode && this.props.currentUser.username}
        </option>
        {users.map((user, i) => {
          return (
            <option key={'user' + i} value={user}>{user}</option>
          )
        })
        }
      </Field>
    </div>)
  }

  renderAddress = (isPublicMode) => {
    const userAddresses = this.props.accounts && this.props.launchPad.username ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.launchPad.username])
      : [];
    return (<div className={isPublicMode ? "" : "pt-select"}>
      <Field
        className="pt-input"
        component="select"
        name="appUserAddress"
        validate={required}
        required
        disabled={isPublicMode}
      >
        <option value={isPublicMode ? this.props.currentUser.accountAddress : null}>
          {isPublicMode && this.props.currentUser.accountAddress}
        </option>
        {
          userAddresses.map((address, i) => {
            return (
              <option key={address} value={address}>{address}</option>
            )
          })
        }
      </Field>
    </div>)
  }

  render() {
    const isPublicMode = isModePublic();
    const { handleSubmit, pristine, submitting, valid } = this.props;

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
                <i className='fa fa-rocket smd-margin-right-8'> </i>
                Apps
              </button>
            </Link>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            {!canDeployApps
              ? <div className="pt-card"><span>Unable to deploy apps when running multinode on localhost</span></div>
              :
            <div className="pt-card">
              <div className="row">
                <div className="col-sm-6">
                  <h4>Enter application details</h4>
                </div>
                <div className="col-sm-6 text-right">
                  <Button onClick={this.props.openCLIOverlay} className="pt-button pt-minimal">
                    <i className='fa fa-info-circle smd-margin-right-8'> </i>
                    Instructions
                    </Button>
                  <a href="https://developers.blockapps.net/advanced/launch-dapp/" target="_blank" rel="noopener noreferrer">
                    <button className="pt-button pt-minimal pt-intent-primary">
                      <i className='fa fa-book smd-margin-right-8'> </i>
                      Read the docs
                    </button>
                  </a>
                </div>
              </div>
              <hr />
              <form>
                <div className="row smd-pad-top-12">
                  <div className="col-sm-2 text-right">
                    <label className="pt-label smd-pad-vertical-4" htmlFor="appName">
                      Username
                    </label>
                  </div>
                  <div className="col-sm-10">
                    {this.renderUsername(isPublicMode)}
                  </div>
                </div>
                <div className="row">
                  <div className="col-sm-2 text-right">
                    <label className="pt-label smd-pad-vertical-4" htmlFor="appName">
                      User Address
                    </label>
                  </div>
                  <div className="col-sm-10">
                    {this.renderAddress(isPublicMode)}
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
                  <div className="col-sm-offset-2 col-sm-1">
                    <button
                      type="submit"
                      onClick={handleSubmit(this.submit)}
                      className="pt-button pt-intent-primary"
                      disabled={pristine || submitting || !valid}
                    >
                      Upload
                    </button>
                  </div>
                  <div className="col-sm-9">
                    <div className="smd-pad-4 smd-text-warning">
                      {this.props.launchPad.error}
                    </div>
                  </div>
                </div>
              </form>
            </div>}
          </div>
        </div>
      </div>
    );
  }

}

function validate(values) {
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
  if (!values.appPackage) {
    errors.appPackage = "Upload file";
  }
  return errors;
}

export function mapStateToProps(state) {
  return {
    accounts: state.accounts.accounts,
    launchPad: state.launchPad,
    currentUser: state.user.currentUser,
    initialValues: {
      appUsername: state.user.currentUser.username,
      appUserAddress: state.user.currentUser.accountAddress
    },
    isOpen: state.cli.isOpen
  };
}

const CREATE_APP_FORM = 'create-app';

const formed = reduxForm({ form: CREATE_APP_FORM, validate })(LaunchPad);

export default withRouter(
  connect(mapStateToProps,
    {
      usernameChange,
      loadLaunchPad,
      fetchAccounts,
      fetchUserAddresses,
      appUploadRequest,
      appSetError,
      appReset,
    }
  )(formed)
);
