import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Dialog, Button, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import mixpanelWrapper from '../../../lib/mixpanelWrapper';
import validate from './validate';
import { closeDownloadModal, downloadRequest, resetError, clearUrl } from './download.actions';
import { toasts } from '../../Toasts';

class Download extends Component {

  constructor(props) {
    super(props);
    this.state = { errors: null }
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.downloadError) {
      toasts.show({ message: nextProps.downloadError });
      this.props.resetError();
    }
    if (nextProps.downloadUrl) {
      window.open(nextProps.downloadUrl, "_parent")
      this.props.clearUrl();
    }
  }

  submit = (values) => {
    let errors = validate(values);
    this.setState({ errors });

    if (!Object.values(errors).length) {
      this.props.downloadRequest(values.contractAddress);
    }
  }

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  renderDownloadForm() {
    return (
      <form>
        <div className="pt-dialog-body upload-form">

          <div className="row">
            <div className="col-sm-4 text-right">
              <label className="pt-label smd-pad-4">
                Contract Address
            </label>
            </div>
            <div className="col-sm-8 smd-pad-4">
              <Field
                name="contractAddress"
                component="input"
                type="text"
                placeholder="Contract Address"
                className="pt-input form-width"
                tabIndex="1"
                required
              />
              <br /><span className="error-text">{this.errorMessageFor('contractAddress')}</span>
            </div>
          </div>

          <div className="pt-dialog-footer">
            <div className="pt-dialog-footer-actions button-center smd-margin-8">
              <Button
                intent={Intent.PRIMARY}
                onClick={this.props.handleSubmit(this.submit)}
                text="Download"
              />
            </div>
          </div>
        </div>
      </form>
    );
  }

  render() {
    return (
      <div>
        <Dialog
          isOpen={this.props.isOpen}
          onClose={() => {
            mixpanelWrapper.track('close_download_modal');
            this.props.closeDownloadModal();
            this.props.reset();
          }}
          iconName='pt-icon-download'
          title='Download'
          className="pt-dark"
        >
          {this.renderDownloadForm()}
        </Dialog>
      </div>
    )
  }
}

export function mapStateToProps(state) {
  return {
    isOpen: state.download.isOpen,
    downloadError: state.download.error,
    downloadUrl: state.download.url
  };
}

const formed = reduxForm({ form: 'verify-form' })(Download);
const connected = connect(
  mapStateToProps,
  {
    closeDownloadModal,
    downloadRequest,
    resetError,
    clearUrl
  }
)(formed);

export default withRouter(connected);