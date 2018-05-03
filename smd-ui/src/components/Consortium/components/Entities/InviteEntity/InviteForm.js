import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Field, reduxForm } from 'redux-form';
import { Button } from '@blueprintjs/core';
import mixpanelWrapper from '../../../../../lib/mixpanelWrapper';
import { closeInviteEntityModal } from '../entities.actions';
import { validate } from './validate';

class InviteForm extends Component {

  constructor() {
    super();
    this.state = { errors: null };
  }

  submit = (values) => {
    let errors = validate(values);
    this.setState({ errors });
    // TODO to submit values
  }

  errorMessageFor = (fieldName) => {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  render() {
    return (
      <div>
        <div className="pt-dialog-body">
          <div className="pt-form-group">
            <div className="pt-form-group pt-intent-danger">
              <label className="pt-label" htmlFor="input-a">
                Entity Name
              </label>
              <div className="pt-form-content">
                <Field
                  name="entityName"
                  className="pt-input form-width smd-full-width"
                  placeholder="Entity Name"
                  component="input"
                  type="input"
                  required
                />
                <div className="error-text">{this.errorMessageFor('entityName')}</div>
              </div>
            </div>

            <div className="pt-form-group pt-intent-danger">
              <label className="pt-label" htmlFor="input-b">
                E-Node URL
              </label>
              <div className="pt-form-content">
                <Field
                  name="nodeUrl"
                  className="pt-input form-width"
                  placeholder="E-Node URL"
                  component="input"
                  type="input"
                  required
                />
              </div>
              <div className="error-text">{this.errorMessageFor('nodeUrl')}</div>
            </div>

            <div className="pt-form-group pt-intent-danger">
              <label className="pt-label" htmlFor="input-b">
                Admin Ethereum Address
              </label>
              <div className="pt-form-content">
                <Field
                  name="adminEtheriumAddress"
                  className="pt-input form-width"
                  placeholder="Admin Ethereum Address"
                  component="input"
                  type="input"
                  required
                />
                <div className="error-text">{this.errorMessageFor('adminEtheriumAddress')}</div>
              </div>
            </div>

            <div className="pt-form-group pt-intent-danger">
              <label className="pt-label" htmlFor="input-b">
                Admin Name
              </label>
              <div className="pt-form-content">
                <Field
                  name="adminName"
                  className="pt-input form-width"
                  placeholder="Admin Name"
                  component="input"
                  type="input"
                  required
                />
                <div className="error-text">{this.errorMessageFor('adminName')}</div>
              </div>
            </div>

            <div className="pt-form-group pt-intent-danger">
              <label className="pt-label" htmlFor="input-b">
                Admin Email
              </label>
              <div className="pt-form-content">
                <Field
                  name="adminEmail"
                  className="pt-input form-width"
                  placeholder="Admin Email"
                  component="input"
                  type="input"
                  required
                />
                <div className="error-text">{this.errorMessageFor('adminEmail')}</div>
              </div>
            </div>

            <div className="pt-form-group pt-intent-danger">
              <label className="pt-label" htmlFor="input-b">
                Send Token Amount
              </label>
              <div className="pt-form-content">
                <Field
                  name="tokenAmount"
                  className="pt-input form-width"
                  placeholder="Send Token Amount"
                  component="input"
                  type="input"
                  required
                />
                <div className="error-text">{this.errorMessageFor('tokenAmount')}</div>
              </div>
            </div>

          </div>
        </div>

        <div className="pt-dialog-footer">
          <div className="pt-dialog-footer-actions button-center">
            <Button onClick={() => {
              mixpanelWrapper.track('cancel_invite_entity');
              this.props.closeInviteEntityModal();
            }} text="Cancel" />
            <Button
              type="button"
              onClick={this.props.handleSubmit(this.submit)}
              text='Invite'
              className="pt-intent-primary"
            />
          </div>
        </div>
      </div>
    )
  }
}

const formed = reduxForm({ form: 'invite-entity' })(InviteForm);

export function mapStateToProps(state) {
  return {

  };
}

const connected = connect(mapStateToProps, {
  closeInviteEntityModal
})(formed);

export default withRouter(connected);
