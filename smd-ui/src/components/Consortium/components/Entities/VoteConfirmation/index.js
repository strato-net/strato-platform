import React, { Component } from 'react';
import { Dialog, Button, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { validate } from './validate';
import { connect } from "react-redux";
import './voteConfirmation.css';

class VoteConfirmation extends Component {

  constructor() {
    super();
    this.state = { errors: null };
  }

  errorMessageFor = (fieldName) => {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  submit = (values) => {
    let errors = validate(values);
    this.setState({ errors });

    if (JSON.stringify(errors) === JSON.stringify({})) {
      console.log(values)
      console.log(this.props.voteType)
    }
  }

  render() {
    const entities = this.props.entities.filter(entity => entity.name !== this.props.entityName)
    return (
      <div>
        <Dialog
          isOpen={this.props.isOpen}
          onClose={() => {
            this.props.handleClose();
          }}
          title="Voting Confirmation"
          className="pt-dark dialog"
        >
          <div className="voting-confirmation">
            <h4>Confirmation</h4>
            <p>You are voting {this.props.voteType} <b>{this.props.entityName}</b></p>
            <form className="voting-form">
              <p className="error-text">An error</p>
              <div className="pt-form-content">
                <label htmlFor="input-a" className="col-sm-2">
                  Entity
                </label>
                <div className="pt-select">
                  <Field
                    className="pt-input"
                    component="select"
                    name="entity"
                    required
                  >
                    <option />
                    {entities.map((entity, i) =>
                      <option key={'entity' + i} value={entity.name}>{entity.name}</option>
                    )}
                  </Field>
                </div>
                <div className="error-text">{this.errorMessageFor('entity')}</div>
              </div>
              <div className="pt-form-content">
                <label htmlFor="input-a" className="col-sm-2">
                  Password
                </label>
                <Field
                  name="password"
                  className="pt-input"
                  placeholder="Your Password"
                  component="input"
                  type="password"
                  required
                />
                <div className="error-text">{this.errorMessageFor('password')}</div>
              </div>
              <Button
                intent={Intent.PRIMARY}
                text="Submit"
                type="submit"
                onClick={this.props.handleSubmit(this.submit)}
              />
            </form>
          </div>
        </Dialog>
      </div>
    )
  }
}

export function mapStateToProps(state) {
  return {
    entities: state.entities.entities
  };
}

const formed = reduxForm({ form: 'vote' })(VoteConfirmation);

const connected = connect(mapStateToProps)(formed);

export default connected;