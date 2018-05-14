import React, { Component } from 'react';
import { Dialog, Button, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { validate } from './validate';
import { connect } from "react-redux";
import { fetchEntities, vote } from "../entities.actions";
import { toasts } from "../../../../Toasts";
import './voteConfirmation.css';

class VoteConfirmation extends Component {

  constructor() {
    super();
    this.state = { errors: null };
  }

  componentWillReceiveProps(nextProps) {
    if (!this.props.isVoted && nextProps.isVoted) {
      toasts.show({ message: 'Your vote was recorded successfully' });
      this.props.reset();
      this.props.fetchEntities();
      this.props.handleClose();
    }
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
      const vote = values;
      vote.voteType = (this.props.voteType === 'against') ? 'disagree' : 'agree';
      vote.entityID = this.props.entity.id;
      this.props.vote(vote);
    }
  }

  render() {
    const entities = this.props.entity
      ? this.props.entities.filter(entity => ((entity.name !== this.props.entity.name) && (entity.status !== 'Pending')))
      : []
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
            <p>You are voting {this.props.voteType} <b>{this.props.entity ? this.props.entity.name : ''}</b></p>
            <form className="voting-form">
              <p className="error-text">{this.props.serverError}</p>
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
    entities: state.entities.entities,
    serverError: state.entities.message,
    isVoted: state.entities.isVoted,
  };
}

const formed = reduxForm({ form: 'vote' })(VoteConfirmation);

const connected = connect(mapStateToProps, { fetchEntities, vote })(formed);

export default connected;