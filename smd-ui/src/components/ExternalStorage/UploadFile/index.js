import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Dialog, Button, Intent } from '@blueprintjs/core';
import mixpanelWrapper from '../../../lib/mixpanelWrapper';
import { closeUploadModal, uploadFileRequest } from './uploadFile.actions';
import { Field, reduxForm } from 'redux-form';
import Dropzone from 'react-dropzone';

import './uploadFile.css';

class UplaodFile extends Component {

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
    values.file = values.content[0];
    this.props.uploadFileRequest(values);
  }

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  dialogContent() {
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
            />
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
            />
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
            />
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
            />
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
              </Field>
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
            />
          </div>
        </div>
      </div>
    );
  }

  render() {
    return (
      <div>
        <form>
          <Dialog
            isOpen={this.props.isOpen}
            onClose={() => {
              mixpanelWrapper.track('close_upload_modal');
              this.props.closeUploadModal();
            }}
            title='Upload'
            className="pt-dark"
          >
            {this.dialogContent()}
            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button
                  intent={Intent.PRIMARY}
                  onClick={this.props.handleSubmit(this.submit)}
                  text="Upload"
                />
              </div>
            </div>
          </Dialog>
        </form>
      </div>
    )
  }
}

export function mapStateToProps(state) {
  return {
    isOpen: state.uploadFile.isOpen
  };
}

const formed = reduxForm({ form: 'upload-file' })(UplaodFile);
const connected = connect(
  mapStateToProps,
  {
    closeUploadModal,
    uploadFileRequest
  }
)(formed);

export default withRouter(connected);