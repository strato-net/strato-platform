import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Field, reduxForm } from 'redux-form';
import { Button } from '@blueprintjs/core';
import mixpanelWrapper from '../../../../../lib/mixpanelWrapper';
import { inviteEntityRequest, closeInviteEntityModal } from '../entities.actions';
import { validate } from './validate';

class InviteForm extends Component {

  constructor() {
    super();
    this.state = { errors: null };
  }

  submit = (values) => {
    let errors = validate(values);
    this.setState({ errors });

    if (JSON.stringify(errors) === JSON.stringify({})) {
      const entity = values;
      this.props.inviteEntityRequest(entity);
    }
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
        <form>
          <div className="pt-dialog-body">
            <div className="pt-form-group">
              <p className="error-text">{this.props.serverError}</p>
              <div className="pt-form-group pt-intent-danger">
                <label className="pt-label" htmlFor="input-a">
                  Entity Name
                </label>
                <div className="pt-form-content">
                  <Field
                    name="name"
                    className="pt-input form-width smd-full-width"
                    placeholder="Entity Name"
                    component="input"
                    type="text"
                    required
                  />
                  <div className="error-text">{this.errorMessageFor('name')}</div>
                </div>
              </div>

              <div className="pt-form-group pt-intent-danger">
                <label className="pt-label" htmlFor="input-b">
                  E-Node URL
                </label>
                <div className="pt-form-content">
                  <Field
                    name="eNodeUrl"
                    className="pt-input form-width"
                    placeholder="E-Node URL"
                    component="input"
                    type="text"
                    required
                  />
                </div>
                <div className="error-text">{this.errorMessageFor('eNodeUrl')}</div>
              </div>

              <div className="pt-form-group pt-intent-danger">
                <label className="pt-label" htmlFor="input-b">
                  Admin Ethereum Address
                </label>
                <div className="pt-form-content">
                  <Field
                    name="adminEthereumAddress"
                    className="pt-input form-width"
                    placeholder="Admin Ethereum Address"
                    component="input"
                    type="text"
                    required
                  />
                  <div className="error-text">{this.errorMessageFor('adminEthereumAddress')}</div>
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
                    type="text"
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
                    type="text"
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
                    type="number"
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
                type="submit"
                onClick={this.props.handleSubmit(this.submit)}
                text='Invite'
                className="pt-intent-primary"
                disabled={this.props.spinning}
              />
            </div>
          </div>
        </form>
      </div>
    )
  }
}

const formed = reduxForm({ form: 'invite-entity' })(InviteForm);

export function mapStateToProps(state) {
  return {
    spinning: state.createConsortium.spinning
  };
}

const connected = connect(mapStateToProps, {
  closeInviteEntityModal,
  inviteEntityRequest,
})(formed);

export default withRouter(connected);
