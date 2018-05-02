import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import { Button, Intent } from '@blueprintjs/core';
import { connect } from 'react-redux';
import { validate } from './validate';
import { addConsortiumInformation } from '../createConsortium.actions';
import './consortiumDetail.css';

class ConsortiumDetail extends Component {

  constructor() {
    super();
    this.state = { errors: null }
  }

  submit = (values) => {
    let errors = validate(values);
    this.setState({ errors });

    if (JSON.stringify(errors) === JSON.stringify({})) {
      this.props.addConsortiumInformation(values);
      this.props.handleNextStep();
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
      <form className="consortium-information">
        <div className="row field-wrapper">
          <div className="col-sm-4 text-left">
            <label className="pt-label smd-pad-4">
              Network ID:
            </label>
          </div>
          <div className="col-sm-8 smd-pad-4">
            <Field
              id="networkId"
              className="form-width pt-input"
              name="networkId"
              type="number"
              component="input"
              dir="auto"
              title="networkId"
              required
            />
            <div className="error-text">{this.errorMessageFor('networkId')}</div>
          </div>
        </div>
        <div className="row field-wrapper">
          <div className="col-sm-4 text-left">
            <label className="pt-label smd-pad-4">
              Add entity rules:
            </label>
          </div>
          <div className="col-sm-8 smd-pad-4">
            <div>
              <label>
                <Field name="addEntityRules" component="input" type="radio" value="AutoApprove" />
                {' '}
                AutoApprove
              </label>
            </div>
            <div>
              <label>
                <Field name="addEntityRules" component="input" type="radio" value="Majority Rules" />
                {' '}
                Majority Rules
              </label>
            </div>
            <div>
              <label>
                <Field name="addEntityRules" component="input" type="radio" value="TwoVotesIn" />
                {' '}
                TwoVotesIn
              </label>
            </div>
            <div className="error-text">{this.errorMessageFor('addEntityRules')}</div>
          </div>
        </div>
        <div className="row field-wrapper">
          <div className="col-sm-4 text-left">
            <label className="pt-label smd-pad-4">
              Remove entity rules:
            </label>
          </div>
          <div className="col-sm-8 smd-pad-4">
            <div>
              <label>
                <Field name="removeEntityRules" component="input" type="radio" value="AutoRemove" />
                {' '}
                AutoRemove
              </label>
            </div>
            <div>
              <label>
                <Field name="removeEntityRules" component="input" type="radio" value="Majority Rules" />
                {' '}
                Majority Rules
              </label>
            </div>
            <div>
              <label>
                <Field name="removeEntityRules" component="input" type="radio" value="TwoVotesIn" />
                {' '}
                TwoVotesIn
              </label>
            </div>
            <div className="error-text">{this.errorMessageFor('removeEntityRules')}</div>
          </div>
        </div>
        <div className="footer">
          <Button
            intent={Intent.PRIMARY}
            text="Next"
            type="submit"
            onClick={this.props.handleSubmit(this.submit)}
          />
        </div>
      </form>
    )
  }
}

const formed = reduxForm({ form: 'consortium-information' })(ConsortiumDetail);
const connected = connect(null, { addConsortiumInformation })(formed);
export default connected;
