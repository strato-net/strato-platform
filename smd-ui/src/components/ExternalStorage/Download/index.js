import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Dialog, Button, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import mixpanelWrapper from '../../../lib/mixpanelWrapper';
import validate from './validate';
import { closeVerifyModal } from './verify.action';

class Verify extends Component {

  constructor(props) {
    super(props);
    this.state = { errors: null }
  }

  submit = (values) => {
    let errors = validate(values);
    this.setState({ errors });

    if (JSON.stringify(errors) === JSON.stringify({})) {
      this.props.attestDocument(values.contractAddress);
    }
  }

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  renderAttestForm() {
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
              text="Attest"
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
              mixpanelWrapper.track('close_verify_modal');
              this.props.closeVerifyModal();
            }}
            iconName={'inbox'}
            title={'Verify'}
            className="pt-dark"
          >
            {this.renderAttestForm()}
          </Dialog>
        </form>
      </div>
    )
  }
}

export function mapStateToProps(state) {
  return {
    isOpen: state.verify.isOpen
  };
}

const formed = reduxForm({ form: 'verify-form' })(Verify);
const connected = connect(
  mapStateToProps,
  {
    closeVerifyModal
  }
)(formed);

export default withRouter(connected);