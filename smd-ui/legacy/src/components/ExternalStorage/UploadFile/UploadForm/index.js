import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button, Intent } from '@blueprintjs/core';
import { closeUploadModal, uploadFileRequest, changeUsername } from '../uploadFile.actions';
import { Field, reduxForm } from 'redux-form';
import Dropzone from 'react-dropzone';
import { validate } from '../validate';
import { isOauthEnabled } from '../../../../lib/checkMode';
import { fetchUserAddresses } from '../../../Accounts/accounts.actions';

class UploadForm extends Component {

  constructor(props) {
    super(props);
    this.state = { errors: null }
  }

  renderDropzoneInput = (field) => {
    const touchedAndHasErrors = field.meta.touched && field.meta.error
    return (
      <div className="dropzoneContainer text-center upload-file">
        <Dropzone
          className="dropzone"
          name={'file'}
          onDrop={(filesToUpload, e) => this.handleFileDrop(filesToUpload, field)}
        >
          {({ isDragActive, isDragReject, acceptedFiles }) => {
            if (isDragActive) {
              return (<p className="pt-intent-success">Drop to Upload!</p>);
            }
            return (<p className="pt-intent-success">{acceptedFiles.length > 0 ? acceptedFiles[0].name : 'Drop a file here, or click to select files to upload.'}</p>)
          }}
        </Dropzone>
        {touchedAndHasErrors && <span className="error">{field.meta.error}</span>}
      </div>
    );
  };

  handleFileDrop = (files, dropZoneField) => {
    dropZoneField.input.onChange(files);
  };

  submit = (values) => {
    let errors = validate(values);
    this.setState({ errors });

    if (!Object.values(errors).length) {
      values.file = values.content[0];
      this.props.uploadFileRequest(values);
      this.props.reset();
    }
  }

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  handleUsernameChange = (e) => {
    this.props.changeUsername(e.target.value);
    this.props.fetchUserAddresses(e.target.value, true)
  };

  renderUsername = (isModeOauth) => {
    const users = Object.getOwnPropertyNames(this.props.accounts);
    return (<div className={isModeOauth ? "" : "pt-select"}>
      <Field
        className="pt-input"
        component="select"
        name="username"
        onChange={this.handleUsernameChange}
        required
        disabled={isModeOauth}
      >
        <option value={isModeOauth ? this.props.initialValues.username : null}>
          {isModeOauth && this.props.initialValues.username}
        </option>
        {
          users.map((user, i) => {
            return (
              <option key={'user' + i} value={user}>{user}</option>
            )
          })
        }
      </Field>
    </div>)
  };

  renderAuth = () => {
    const isModeOauth = isOauthEnabled();

    return <div>
      <div className="row">
        <div className="col-sm-3 text-right">
          <label className="pt-label smd-pad-4">
            Username
          </label>
        </div>
        <div className="col-sm-9 smd-pad-4">
          {this.renderUsername(isModeOauth)}
          <br /><span className="error-text">{this.errorMessageFor('username')}</span>
        </div>
      </div>
      <div className="row">
        <div className="col-sm-3 text-right">
          <label className="pt-label smd-pad-4">
            Address
          </label>
        </div>
        <div className="col-sm-9 smd-pad-4">
          {this.renderAddress(isModeOauth)}
          <br /> <span className="error-text">{this.errorMessageFor('address')}</span>
        </div>
      </div>
      {!isModeOauth && <div className="row">
        <div className="col-sm-3 text-right">
          <label className="pt-label smd-pad-4">
            Password
          </label>
        </div>
        <div className="col-sm-9 smd-pad-4">
          <Field
            name="password"
            component="input"
            type="password"
            placeholder="Password"
            className="pt-input form-width"
            tabIndex="3"
            required
          /> <br />
          <span className="error-text">{this.errorMessageFor('password')}</span>
        </div>
      </div>}
    </div>
  }

  renderAddress = (isModeOauth) => {
    const userAddresses = this.props.accounts && this.props.username ?
      Object.getOwnPropertyNames(this.props.accounts[this.props.username])
      : [];
    return (<div className={isModeOauth ? "" : "pt-select"}>
      <Field
        className="pt-input"
        component="select"
        name="address"
        required
        disabled={isModeOauth}
      >
        <option value={isModeOauth ? this.props.initialValues.address : null}>
          {isModeOauth && this.props.initialValues.address}
        </option>
        {
          userAddresses.map((address, i) => {
            return (
              <option key={address} value={address}>{address}</option>
            )
          })
        }
      </Field>
    </div>);
  };

  render() {
    return (
      <div>
        <form>
          <div className="pt-dialog-body upload-form">

            {this.renderAuth()}

            <div className="row">
              <div className="col-sm-3 text-right">
                <label className="pt-label smd-pad-4">
                  File
            </label>
              </div>
              <div className="col-sm-9 smd-pad-4">
                <Field
                  id="input-b"
                  component={this.renderDropzoneInput}
                  className="form-width pt-input"
                  name="content"
                  dir="auto"
                  title="Content"
                  tabIndex="4"
                  required
                /> <br />
                <span className="error-text">{this.errorMessageFor('content')}</span>
              </div>
            </div>

            <div className="row">
              <div className="col-sm-3 text-right">
                <label className="pt-label smd-pad-4">
                  Provider
            </label>
              </div>
              <div className="col-sm-9 smd-pad-4">
                <div className="pt-select">
                  <Field
                    className="pt-input"
                    component="select"
                    name="provider"
                    tabIndex="5"
                    required
                  >
                    <option value={'s3'}> s3 </option>
                  </Field> <br />
                  <span className="error-text">{this.errorMessageFor('provider')}</span>
                </div>
              </div>
            </div>

            <div className="row">
              <div className="col-sm-3 text-right">
                <label className="pt-label smd-pad-4">
                  Description
            </label>
              </div>
              <div className="col-sm-9 smd-pad-4">
                <Field
                  name="description"
                  component="input"
                  type="text"
                  placeholder="Description"
                  className="pt-input form-width"
                  tabIndex="6"
                  required
                /> <br />
                <span className="error-text">{this.errorMessageFor('description')}</span>
              </div>
            </div>

            <div className="pt-dialog-footer upload-button">
              <div className="pt-dialog-footer-actions button-center upload">
                <Button
                  intent={Intent.PRIMARY}
                  onClick={this.props.handleSubmit(this.submit)}
                  disabled={this.props.isLoading}
                  text="Upload"
                />
              </div>
            </div>
          </div>
        </form>
      </div>
    )
  }
}

export function mapStateToProps(state) {
  return {
    accounts: state.accounts.accounts,
    username: state.uploadFile.username,
    isLoading: state.uploadFile.isLoading,
    initialValues: {
      username: state.user.oauthUser ? state.user.oauthUser.commonName : '',
      address: state.user.oauthUser ? state.user.oauthUser.address : '',
      provider: 's3'
    }
  };
}

const formed = reduxForm({ form: 'upload-file' })(UploadForm);
const connected = connect(
  mapStateToProps,
  {
    closeUploadModal,
    uploadFileRequest,
    fetchUserAddresses,
    changeUsername
  }
)(formed);

export default withRouter(connected);
