import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Dialog, Button, Intent } from '@blueprintjs/core';
import mixpanelWrapper from '../../../lib/mixpanelWrapper';
import { closeUploadModal, uploadFileRequest, resetError } from './uploadFile.actions';
import { Field, reduxForm, reset } from 'redux-form';
import Dropzone from 'react-dropzone';
import { toasts } from '../../Toasts';
import { validate } from './validate';

import './uploadFile.css';

class UplaodFile extends Component {

  constructor(props) {
    super(props);
    this.state = { errors: null }
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.uploadError) {
      toasts.show({ message: nextProps.uploadError });
      this.props.resetError();
    }
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

    if (JSON.stringify(errors) === JSON.stringify({})) {
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

  uploadForm() {
    return (
      <div className="pt-dialog-body">

        <div className="row">
          <div className="col-sm-3 text-right">
            <label className="pt-label smd-pad-4">
              Username
            </label>
          </div>
          <div className="col-sm-9 smd-pad-4">
            <Field
              name="username"
              component="input"
              type="text"
              placeholder="Username"
              className="pt-input form-width"
              tabIndex="1"
              required
            /> <br />
            <span className="error-text">{this.errorMessageFor('username')}</span>
          </div>
        </div>

        <div className="row">
          <div className="col-sm-3 text-right">
            <label className="pt-label smd-pad-4">
              Address
            </label>
          </div>
          <div className="col-sm-9 smd-pad-4">
            <Field
              name="address"
              component="input"
              type="text"
              placeholder="Address"
              className="pt-input form-width"
              tabIndex="2"
              required
            /> <br />
            <span className="error-text">{this.errorMessageFor('address')}</span>
          </div>
        </div>

        <div className="row">
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
        </div>

        <div className="row">
          <div className="col-sm-3 text-right">
            <label className="pt-label smd-pad-4">
              Drop Video
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

        <div className="pt-dialog-footer">
          <div className="pt-dialog-footer-actions button-center">
            <Button
              intent={Intent.PRIMARY}
              onClick={this.props.handleSubmit(this.submit)}
              text="Upload"
            />
          </div>
        </div>
      </div>
    );
  }

  renderSuccess(data) {
    return (
      <div>
        <div className="pt-dialog-body">

          <div className="row content-margin">
            <div className="col-sm-4">
              <label> Contract Address </label>
            </div>
            <div className="col-sm-8">
              <label> {data.contractAddress} </label>
            </div>
          </div>

          <div className="row content-margin">
            <div className="col-sm-4">
              <label> URI </label>
            </div>
            <div className="col-sm-8">
              <label> {data.uri} </label>
            </div>
          </div>

          <div className="row content-margin">
            <div className="col-sm-4">
              <label> Description </label>
            </div>
            <div className="col-sm-8">
              <label> {data.metadata} </label>
            </div>
          </div>

        </div>

        <div className="pt-dialog-footer">
          <div className="pt-dialog-footer-actions button-center">
            <Button
              intent={Intent.PRIMARY}
              onClick={() => this.closeModal()}
              text="Close"
            />
          </div>
        </div>
      </div>
    )
  }

  closeModal() {
    this.props.closeUploadModal();
    this.props.reset();
  }

  render() {
    let result = this.props.result;

    return (
      <div>
        <form>
          <Dialog
            isOpen={this.props.isOpen}
            onClose={() => {
              mixpanelWrapper.track('close_upload_modal');
              this.closeModal();
            }}
            iconName={result ? 'saved' : 'inbox'}
            title={result ? 'URI Upload Success' : 'Upload'}
            className="pt-dark upload-dialog"
          >
            {result ? this.renderSuccess(result) : this.uploadForm()}
          </Dialog>
        </form>
      </div>
    )
  }
}

export function mapStateToProps(state) {
  return {
    isOpen: state.uploadFile.isOpen,
    uploadError: state.uploadFile.error,
    result: state.uploadFile.result
  };
}

const formed = reduxForm({ form: 'upload-file' })(UplaodFile);
const connected = connect(
  mapStateToProps,
  {
    closeUploadModal,
    uploadFileRequest,
    resetError
  }
)(formed);

export default withRouter(connected);