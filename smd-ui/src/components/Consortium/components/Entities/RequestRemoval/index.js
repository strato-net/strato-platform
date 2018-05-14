import React, { Component } from "react";
import { connect } from "react-redux";
import { Dialog, Button, Intent } from '@blueprintjs/core';
import { openRequestRemovalModal, closeRequestRemovalModal, vote } from "../entities.actions";
import { Field, reduxForm } from 'redux-form';
import { validate } from "./validate";

class RequestRemoval extends Component {

  constructor(props) {
    super(props);
    this.state = { errors: null, requestedRemovalFor: [] };
  }

  componentWillReceiveProps(nextProps) {
    if (!this.props.isVoted && nextProps.isVoted)
      this.props.closeRequestRemovalModal()
  }

  submit = (values) => {
    let errors = validate(values);
    this.setState({ errors });

    if (JSON.stringify(errors) === JSON.stringify({})) {
      values.voteType = "agree";
      this.props.vote(values);
    }
  }

  errorMessageFor = (fieldName) => {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  handleEntityChange = (event) => {
    const requestedRemovalFor = this.props.entities.filter(entity => (entity.id !== Number(event.target.value)) && (entity.status === 'Member'))
    this.setState({ requestedRemovalFor })
  }

  render() {
    let entities = this.props.entities;
    let memberEntities = entities && entities.filter(entity => entity.status !== "Pending");

    return (
      <span>
        <Button
          className="pt-intent-danger pt-icon-remove"
          text="Request Removal"
          onClick={() => {
            this.props.reset();
            this.props.openRequestRemovalModal()
          }}
        />
        <Dialog
          isOpen={this.props.isRequestRemovalModalOpen}
          onClose={() => {
            this.props.closeRequestRemovalModal();
          }}
          title="Request Removal"
          className="pt-dark"
        >
          <form>
            <div className="pt-dialog-body">
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Select Entity
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <div className="pt-select">
                    <Field
                      className="pt-input"
                      component="select"
                      name="entityID"
                      onChange={this.handleEntityChange}
                    >
                      <option />
                      {
                        memberEntities.map((entity, i) => {
                          return (
                            <option key={'entity' + i} value={entity.id}>{entity.name}</option>
                          )
                        })
                      }
                    </Field>
                    <div className="error-text">{this.errorMessageFor('entityID')}</div>
                  </div>
                </div>
              </div>

              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Removal For
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <div className="pt-select">
                    <Field
                      className="pt-input"
                      component="select"
                      name="entity"
                      onChange={this.handleUsernameChange}
                    >
                      <option />
                      {
                        this.state.requestedRemovalFor.map((entity, i) => {
                          return (
                            <option key={'entity' + i} value={entity.name}>{entity.name}</option>
                          )
                        })
                      }
                    </Field>
                    <div className="error-text">{this.errorMessageFor('entity')}</div>
                  </div>
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
                    className="pt-input form-width"
                    placeholder="Enter Password"
                    component="input"
                    type="password"
                    required
                  />
                  <div className="error-text">{this.errorMessageFor('password')}</div>
                </div>
              </div>
              <div className="pt-dialog-footer">
                <div className="pt-dialog-footer-actions button-center">
                  <Button
                    intent={Intent.PRIMARY}
                    text="Submit"
                    onClick={this.props.handleSubmit(this.submit)}
                    type="submit"
                  />
                </div>
              </div>
            </div>
          </form>
        </Dialog>
      </span>
    )
  }

}

export function mapStateToProps(state) {
  return {
    isRequestRemovalModalOpen: state.entities.isRequestRemovalModalOpen,
    entities: state.entities.entities,
    isVoted: state.entities.isVoted,
  };
}

const formed = reduxForm({ form: 'request-removal' })(RequestRemoval);
const connected = connect(mapStateToProps, { openRequestRemovalModal, closeRequestRemovalModal, vote })(formed);
export default connected;
