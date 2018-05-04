import React, { Component } from 'react';
import { Field, reduxForm } from 'redux-form';
import { Button, Intent } from '@blueprintjs/core';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { validate } from './validate';
import { addEntity, createConsortiumRequest } from '../createConsortium.actions';
import './addEntity.css';

class AddEntity extends Component {

  constructor() {
    super();
    this.state = { errors: null }
  }

  errorMessageFor = (fieldName) => {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  addEntity = (values) => {
    let errors = validate(values);
    this.setState({ errors });

    if (JSON.stringify(errors) === JSON.stringify({})) {
      this.props.addEntity(values);
      this.props.reset();
      this.props.handleNextStep();
    }
  }

  finish = (values) => {
    let errors = validate(values);
    this.setState({ errors });

    if (JSON.stringify(errors) === JSON.stringify({})) {
      this.props.createConsortiumRequest(values);
      this.props.history.replace('/consortium');
      this.props.reset();
    }
  }

  render() {
    return (
      <div className="add-entity-wrapper">
        <h4 className="title">Starting entitites {this.props.index}:</h4>
        <form>
          <p className="error-text">{this.props.serverError}</p>
          <div className="row">
            <div className="col-sm-4 text-left">
              <label className="pt-label smd-pad-4">
                Entity Name:
              </label>
            </div>
            <div className="col-sm-8 smd-pad-4">
              <Field
                id="name"
                className="form-width pt-input"
                name="name"
                type="text"
                component="input"
                dir="auto"
                title="name"
                required
              />
              <div className="error-text">{this.errorMessageFor('name')}</div>
            </div>
          </div>
          <div className="row">
            <div className="col-sm-4 text-left">
              <label className="pt-label smd-pad-4">
                E-Node URL:
              </label>
            </div>
            <div className="col-sm-8 smd-pad-4">
              <Field
                id="eNodeUrl"
                className="form-width pt-input"
                name="eNodeUrl"
                type="text"
                component="input"
                dir="auto"
                title="eNodeUrl"
                required
              />
              <div className="error-text">{this.errorMessageFor('eNodeUrl')}</div>
            </div>
          </div>
          <div className="row">
            <div className="col-sm-4 text-left">
              <label className="pt-label smd-pad-4">
                Admin Ethereum Address:
              </label>
            </div>
            <div className="col-sm-8 smd-pad-4">
              <Field
                id="adminEthereumAddress"
                className="form-width pt-input"
                name="adminEthereumAddress"
                type="text"
                component="input"
                dir="auto"
                title="adminEthereumAddress"
                required
              />
              <div className="error-text">{this.errorMessageFor('adminEthereumAddress')}</div>
            </div>
          </div>
          <div className="row">
            <div className="col-sm-4 text-left">
              <label className="pt-label smd-pad-4">
                Admin Name:
              </label>
            </div>
            <div className="col-sm-8 smd-pad-4">
              <Field
                id="adminName"
                className="form-width pt-input"
                name="adminName"
                type="text"
                component="input"
                dir="auto"
                title="adminName"
                required
              />
              <div className="error-text">{this.errorMessageFor('adminName')}</div>
            </div>
          </div>
          <div className="row">
            <div className="col-sm-4 text-left">
              <label className="pt-label smd-pad-4">
                Admin email:
              </label>
            </div>
            <div className="col-sm-8 smd-pad-4">
              <Field
                id="adminEmail"
                className="form-width pt-input"
                name="adminEmail"
                type="text"
                component="input"
                dir="auto"
                title="adminEmail"
                required
              />
              <div className="error-text">{this.errorMessageFor('adminEmail')}</div>
            </div>
          </div>
          <div className="row">
            <div className="col-sm-4 text-left">
              <label className="pt-label smd-pad-4">
                Send Token Amount:
              </label>
            </div>
            <div className="col-sm-8 smd-pad-4">
              <Field
                id="tokenAmount"
                className="form-width pt-input"
                name="tokenAmount"
                type="number"
                component="input"
                dir="auto"
                title="tokenAmount"
                required
              />
              <div className="error-text">{this.errorMessageFor('tokenAmount')}</div>
            </div>
          </div>
          <div className="footer">
            <Button
              intent={Intent.PRIMARY}
              text={this.props.canFinish ? "Add more" : "Continue"}
              type="submit"
              onClick={this.props.handleSubmit(this.addEntity)}
              disabled={this.props.spinning}
            />
            {this.props.canFinish && <Button
              intent={Intent.PRIMARY}
              text="Finish"
              type="submit"
              onClick={this.props.handleSubmit(this.finish)}
              className="finish-btn"
              disabled={this.props.spinning}
            />}
          </div>
        </form>
      </div>
    );
  }

}

export function mapStateToProps(state) {
  return {
    spinning: state.createConsortium.spinning,
    serverError: state.createConsortium.error,
  };
}

const formed = reduxForm({ form: 'add-entity' })(AddEntity);
const connected = connect(mapStateToProps, { addEntity, createConsortiumRequest })(formed);
export default withRouter(connected);
