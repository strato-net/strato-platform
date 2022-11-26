import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button, Dialog, Intent } from '@blueprintjs/core';

import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import { Field, reduxForm } from 'redux-form';
import { openAddMemberModal, closeAddMemberModal } from '../../createChain.actions';
import { validate } from './validate';

class AddMember extends Component {

  constructor(props) {
    super(props)
    this.state = {
      form: {
      },
      orgName: ``,
      orgUnit: ``,
      commonName: ``,
      access: true,
      errors: null
    }
  }

  closeModal = () => {
    this.props.closeAddMemberModal();
  }

  componentDidMount() {
    mixpanelWrapper.track("add_member_loaded");
  }

  handleOrgNameChange(event) {
    this.setState({
      orgName: event.target.value
    });
  }

  handleOrgUnitChange(event) {
    this.setState({
      orgUnit: event.target.value
    });
  }

  handleCommonNameChange(event) {
    this.setState({
      commonName: event.target.value
    });
  }

  handleAccessChange(event) {
    this.setState({
      access: event.target.value
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
      orgName: this.state.orgName,
      orgUnit: this.state.orgUnit,
      commonName: this.state.commonName,
      access: this.state.access
    }
    
    let errors = validate(data);
    this.setState({ errors });

    if (!Object.values(errors).length) {
      mixpanelWrapper.track('add_member_submit_click_successful');
      this.props.handler(data);
      this.props.reset();
      this.closeModal();
    }
  }

  render() {
    return (
      <div >
        <Button onClick={() => {
          mixpanelWrapper.track("add_member_open_click");
          this.props.openAddMemberModal();
        }} className="pt-intent-primary pt-icon-add"
          style={{ marginTop: '8px' }}
          text="Add Member" />

        <Dialog
          iconName="add"
          isOpen={this.props.isOpen}
          onClose={this.closeModal}
          title="Add Member"
          className="pt-dark"
        >
          <form>
            <div className="pt-dialog-body">

              {
                // !this.state.form.userSelected &&
                <div className="row">
                  <div className="col-sm-3 text-right">
                    <label className="pt-label smd-pad-4">
                      Org Name:
                  </label>
                  </div>
                  <div className="col-sm-9 smd-pad-4">
                    <Field
                      id="orgName"
                      className="form-width pt-input"
                      placeholder="Org Name"
                      name="orgName"
                      component="input"
                      dir="auto"
                      title="orgName"
                      onChange={(e) => this.handleOrgNameChange(e)}
                      required
                    />
                    <br /><span className="error-text">{this.errorMessageFor('orgName')}</span>
                  </div>
                </div>
              }

              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Org Unit:
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <div className="form-width">
                    <Field
                      name="orgUnit"
                      component="input"
                      type="text"
                      placeholder="Org Unit"
                      value={this.state.orgUnit}
                      className="pt-input form-width"
                      onChange={(e) => this.handleOrgUnitChange(e)}
                      required
                    />
                    <br /><span className="error-text">{this.errorMessageFor('orgUnit')}</span>
                  </div>
                </div>
              </div>

              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Common Name:
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <div className="form-width">
                    <Field
                      name="commonName"
                      component="input"
                      type="text"
                      placeholder="Common Name"
                      value={this.state.commonName}
                      className="pt-input form-width"
                      onChange={(e) => this.handleCommonNameChange(e)}
                      required
                    />
                    <br /><span className="error-text">{this.errorMessageFor('commonName')}</span>
                  </div>
                </div>
              </div>
              <div className="row">
                <div className="col-sm-3 text-right">
                  <label className="pt-label smd-pad-4">
                    Access
                  </label>
                </div>
                <div className="col-sm-9 smd-pad-4">
                  <div className="form-width">
                  <Field
                      style={{ marginLeft: 25 }}
                      name="radio"
                      component="input"
                      type="radio"
                      value={true}
                      label='Add'
                      checked={this.state.access === true}
                      onClick={() => {
                        this.setState((prevState) => {
                          return {access:true };
                        });
                      }}
                    /> Add
                  <Field
                      style={{ marginLeft: 25 }}
                      name="radio"
                      component="input"
                      type="radio"
                      value={false}
                      label='Remove'
                      checked={this.state.access === false}
                      onClick={() => {
                        this.setState((prevState) => {
                          return {access:false };
                        });
                      }}
                    /> Remove
                    <br /><span className="error-text">{this.errorMessageFor('access')}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button text="Cancel" onClick={() => {
                  mixpanelWrapper.track("add_member_cancel");
                  this.props.reset();
                  this.closeModal();
                }} />
                <Button
                  intent={Intent.PRIMARY}
                  onClick={this.submit}
                  text="Add Member"
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
    isOpen: state.createChain.isAddMemberModalOpen,
    initialValues: {
      orgName: "",
      orgUnit: "",
      commonName: "",
      access: true
    }
  };
}

const formed = reduxForm({ form: 'add-member' })(AddMember);
const connected = connect(mapStateToProps, {
  openAddMemberModal,
  closeAddMemberModal
})(formed);

export default withRouter(connected);
