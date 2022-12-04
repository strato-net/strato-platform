import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button, Dialog, Intent } from '@blueprintjs/core';

import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import { Field, reduxForm } from 'redux-form';
import { openAddIntegrationModal, closeAddIntegrationModal } from '../../createChain.actions';
import { validate } from './validate';

class AddIntegration extends Component {

  constructor(props) {
    super(props)
    this.state = {
      form: {
      },
      name: ``,
      chainId: ``,
      errors: null
    }
  }

  closeModal = () => {
    this.props.closeAddIntegrationModal();
  }

  componentDidMount() {
    mixpanelWrapper.track("add_integration_loaded");
  }

  handleNameChange(event) {
    this.setState({
      name: event.target.value
    });
  }

  handleChainIdChange(event) {
    this.setState({
      chainId: event.target.value
    });
  }

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  submit = () => {
    let data = {
      name: this.state.name,
      chainId: this.state.chainId,
    }
    
    let errors = validate(data);
    this.setState({ errors });

    if (!Object.values(errors).length) {
      mixpanelWrapper.track('add_integration_submit_click_successful');
      this.props.handler(data);
      this.props.reset();
      this.closeModal();
    }
  }

  render() {
    return (
      <div >
        <Button onClick={() => {
          mixpanelWrapper.track("add_integration_open_click");
          this.props.openAddIntegrationModal();
        }} className="pt-intent-primary pt-icon-add"
          style={{ marginTop: '8px' }}
          text="Add App Integration" />

        <Dialog
          iconName="add"
          isOpen={this.props.isOpen}
          onClose={this.closeModal}
          title="Add App Integration"
          className="pt-dark"
        >
          <form>
            <div className="pt-dialog-body">

              {
                // !this.state.form.userSelected &&
                <div className="row">
                  <div className="col-sm-3 text-right">
                    <label className="pt-label smd-pad-4">
                      Name:
                  </label>
                  </div>
                  <div className="col-sm-9 smd-pad-4">
                    <Field
                      id="name"
                      className="form-width pt-input"
                      placeholder="Name"
                      name="name"
                      component="input"
                      dir="auto"
                      title="name"
                      onChange={(e) => this.handleNameChange(e)}
                      required
                    />
                    <br /><span className="error-text">{this.errorMessageFor('name')}</span>
                  </div>
                </div>
              }

              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    App Chain ID:
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <div className="form-width">
                    <Field
                      name="chainId"
                      component="input"
                      type="text"
                      placeholder="App Chain ID"
                      value={this.state.chainId}
                      className="pt-input form-width"
                      onChange={(e) => this.handleChainIdChange(e)}
                      required
                    />
                    <br /><span className="error-text">{this.errorMessageFor('chainId')}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button text="Cancel" onClick={() => {
                  mixpanelWrapper.track("add_integration_cancel");
                  this.props.reset();
                  this.closeModal();
                }} />
                <Button
                  intent={Intent.PRIMARY}
                  onClick={this.submit}
                  text="Add App Integration"
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
  return {
    isOpen: state.createChain.isAddIntegrationModalOpen,
    initialValues: {
      name: "",
      chainId: "",
    }
  };
}

const formed = reduxForm({ form: 'add-integration' })(AddIntegration);
const connected = connect(mapStateToProps, {
  openAddIntegrationModal,
  closeAddIntegrationModal
})(formed);

export default withRouter(connected);
