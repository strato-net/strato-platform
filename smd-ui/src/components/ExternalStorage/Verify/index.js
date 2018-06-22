import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Dialog, Button, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import mixpanelWrapper from '../../../lib/mixpanelWrapper';
import validate from './validate';
import { closeVerifyModal, verifyDocumentRequest } from './verify.action';
import moment from 'moment';
import { parseDateFromString } from '../../../lib/dateUtils';

import './verify.css';

class Verify extends Component {

  constructor(props) {
    super(props);
    this.state = { errors: null }
  }

  submit = (values) => {
    let errors = validate(values);
    this.setState({ errors });

    if (JSON.stringify(errors) === JSON.stringify({})) {
      this.props.verifyDocumentRequest(values.contractAddress);
    }
  }

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  renderForm() {
    return (
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
              disabled={this.props.isLoading}
              text="Attest"
            />
          </div>
        </div>
      </div>
    );
  }

  renderSuccess(data) {

    const signers = data.signers.map((value, key) => {
      return (
        <li key={key}> {value} </li>
      )
    })

    return (
      <div>
        <div className="pt-dialog-body">

          <div className="row content-margin">
            <div className="col-sm-3">
              <label> URI </label>
            </div>
            <div className="col-sm-9">
              <label> {data.uri} </label>
            </div>
          </div>

          <div className="row content-margin">
            <div className="col-sm-3">
              <label> Date Uploaded </label>
            </div>
            <div className="col-sm-9">
              <label> {parseDateFromString(moment(data.timestamp).toISOString())} </label>
            </div>
          </div>

          <div className="row content-margin verify-result">
            <div className="col-sm-3">
              <label> Signatures </label>
            </div>
            <div className="col-sm-9">
              <ul> {signers} </ul>
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
    this.props.closeVerifyModal();
    this.props.reset();
  }

  render() {
    const result = this.props.verifyDocument;
    return (
      <div>
        <form>
          <Dialog
            isOpen={this.props.isOpen}
            onClose={() => {
              mixpanelWrapper.track('close_verify_modal');
              this.closeModal();
            }}
            iconName={result ? 'saved' : 'inbox'}
            title={result ? 'Valid Resource' : 'Verify'}
            className="pt-dark verify-dialog"
          >
            {result ? this.renderSuccess(result) : this.renderForm()}
          </Dialog>
        </form>
      </div>
    )
  }
}

export function mapStateToProps(state) {
  return {
    isOpen: state.verify.isOpen,
    isLoading: state.verify.isLoading,
    verifyDocument: state.verify.verifyDocument
  };
}

const formed = reduxForm({ form: 'verify-form' })(Verify);
const connected = connect(
  mapStateToProps,
  {
    verifyDocumentRequest,
    closeVerifyModal
  }
)(formed);

export default withRouter(connected);