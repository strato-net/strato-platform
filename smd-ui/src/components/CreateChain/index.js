import React, { Component } from 'react';
import { openCreateChainOverlay, closeCreateChainOverlay, createChain } from './createChain.actions';
import { Button, Dialog, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';

import './createChain.css';
import mixpanelWrapper from '../../lib/mixpanelWrapper';

class CreateChain extends Component {

  componentDidMount() {
    mixpanelWrapper.track("create_chain_loaded");
  }

  submit = (values) => {
    mixpanelWrapper.track('create_chain_submit_click');
    this.props.createChain(values.chain_label, values.gov_contract, values.members, values.acct_info);
  }

  render() {
    return (
      <div className="smd-pad-16">
        <Button onClick={() => {
          mixpanelWrapper.track('create_chain_open_click');
          this.props.reset();
          this.props.openCreateChainOverlay();
        }} className="pt-intent-primary pt-icon-add"
          id="accounts-create-chain-button"
          text="Create Chain" />


        <Dialog
          iconName="inbox"
          isOpen={this.props.isOpen}
          onClose={this.props.closeCreateChainOverlay}
          title="Create New Chain"
          className="pt-dark"
        >
          <form>
            <div className="pt-dialog-body">
              <div className="pt-form-group">
                <div className="pt-form-group pt-intent-danger">
                  <label className="pt-label" htmlFor="input-a">
                    Chain Label
                  </label>
                  <div className="pt-form-content">
                    <Field
                      name="label"
                      component="input"
                      type="text"
                      placeholder="Chain Label"
                      className="pt-input form-width"
                      tabIndex="1"
                      required
                    />
                    <div className="pt-form-helper-text">{this.props.errors && this.props.errors.label}</div>
                  </div>
                </div>

                <div className="pt-form-group pt-intent-danger">
                  <label className="pt-label" htmlFor="input-a">
                    Add Rule
                  </label>
                  <div className="pt-form-content">
                    <Field
                      name="addRule"
                      component="input"
                      type="text"
                      placeholder="Add Rule"
                      className="pt-input form-width"
                      tabIndex="1"
                      required
                    />
                    <div className="pt-form-helper-text">{this.props.errors && this.props.errors.addRule}</div>
                  </div>
                </div>

                <div className="pt-form-group pt-intent-danger">
                  <label className="pt-label" htmlFor="input-b">
                    Remove Rule
                  </label>
                  <div className="pt-form-content">
                    <Field
                      name="removeRule"
                      component="input"
                      type="text"
                      placeholder="Remove Rule"
                      className="pt-input form-width"
                      tabIndex="2"
                      required
                    />
                    <div className="pt-form-helper-text">{this.props.errors && this.props.errors.removeRule}</div>
                  </div>
                </div>
              
                <div className="pt-form-group pt-intent-danger">
                  <label className="pt-label" htmlFor="input-b">
                    Members
                  </label>
                  <div className="pt-form-content">
                    <Field
                      name="members"
                      component="input"
                      type="text"
                      placeholder="Members"
                      className="pt-input form-width"
                      tabIndex="3"
                      required
                    />
                    <div className="pt-form-helper-text">{this.props.errors && this.props.errors.members}</div>
                  </div>
                </div>

                <div className="pt-form-group pt-intent-danger">
                  <label className="pt-label" htmlFor="input-b">
                    Account Balance
                  </label>
                  <div className="pt-form-content">
                    <Field
                      name="acctBalance"
                      component="input"
                      type="text"
                      placeholder="Account Balance"
                      className="pt-input form-width"
                      tabIndex="4"
                      required
                    />
                    <div className="pt-form-helper-text">{this.props.errors && this.props.errors.acctBalance}</div>
                  </div>
                </div>
              </div>

              <div>
                <div className="col-sm-3"></div>
                <div className="col-sm-3"></div>
                <div className="col-sm-3"></div>
              </div>
            </div>

            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button text="Cancel" onClick={() => {
                  mixpanelWrapper.track('create_chain_close_click');
                  this.props.reset();
                  this.props.closeCreateChainOverlay();
                }} />
                <Button
                  intent={Intent.PRIMARY}
                  onClick={this.props.handleSubmit(this.submit)}
                  text="Create Chain"
                />
              </div>
            </div>
          </form>
        </Dialog>

      </div>
    );
  }
}

export function mapStateToProps(state) {
  let errors = { errors: undefined };
  if (state.form && state.form["create-chain"]) {
    errors = { errors: state.form["create-chain"].syncErrors }
  }
  return {
    isOpen: state.createBlocUser.isOpen,
    ...errors
  };
}

export function validate(values) { 
  //TODO: add validations for chain creation
  const errors = {};
  return errors;
}

const formed = reduxForm({ form: 'create-chain', validate })(CreateChain);
const connected = connect(
  mapStateToProps,
  {
    openCreateChainOverlay,
    closeCreateChainOverlay,
    createChain,
  }
)(formed);

export default withRouter(connected);
