import React, {Component} from 'react';
import {openOverlay, closeOverlay, createUser} from './createUser.actions';
import {Button, Dialog, Intent, Spinner} from '@blueprintjs/core';
import { Field, reduxForm, formValueSelector } from 'redux-form';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';

import './CreateUser.css';
import mixpanelWrapper from '../../lib/mixpanelWrapper';

class CreateUser extends Component {

  componentDidMount() {
    mixpanelWrapper.track("create_user_loaded");
  }

  submit = (values) => {
    mixpanelWrapper.track('create_user_submit_click');
    this.props.createUser(values.username, values.password);
  }

  render() {
    return (
      <div className="smd-pad-16">
        <Button onClick={() => {
          mixpanelWrapper.track('create_user_open_click');
          this.props.openOverlay()
        }} className="pt-intent-primary pt-icon-add"
                text="Create User"/>
        <form>
          <Dialog
            iconName="inbox"
            isOpen={this.props.isOpen}
            onClose={this.props.closeOverlay}
            title="Create New User"
            className="pt-dark"
          >
            <div className="pt-dialog-body">
              <div className="pt-form-group">

                <div className="input">
                  <label className="pt-label" htmlFor="input-a">
                    Username
                  </label>
                  <div className="pt-form-content">
                    <Field
                      name="username"
                      component="input"
                      type="text"
                      placeholder="Username"
                      className="pt-input form-width"
                    />
                    <div className="pt-form-helper-text">Pick a username</div>
                  </div>
                </div>

                <div className="input">
                  <label className="pt-label" htmlFor="input-b">
                    Password
                  </label>
                  <div className="pt-form-content">
                    <Field
                      name="password"
                      component="input"
                      type="text"
                      placeholder="Password"
                      className="pt-input form-width"
                    />
                    <div className="pt-form-helper-text">Pick a password</div>
                  </div>
                </div>

                <div className="input">
                  <label className="pt-label" htmlFor="input-b">
                    Confirm Password
                  </label>
                  <div className="pt-form-content">
                    <Field
                      name="confirm_password"
                      component="input"
                      type="text"
                      placeholder="Confirm Password"
                      className="pt-input form-width"
                    />
                    <div className="pt-form-helper-text">Pick a password</div>
                  </div>
                </div>
              </div>

              <div>
                <div className="col-sm-3"></div>
                <div className="col-sm-3">{this.props.compileSuccess ? <Spinner className="text-center"/> :
                  <span></span>}</div>
                <div className="col-sm-3"></div>
              </div>
            </div>

            <div className="pt-dialog-footer">
              <div className="pt-dialog-footer-actions">
                <Button text="Cancel" onClick={() => {
                  mixpanelWrapper.track('create_user_close_click');
                  this.props.closeOverlay()
                }}/>
                <Button
                  intent={Intent.PRIMARY}
                  onClick={this.props.handleSubmit(this.submit)}
                  text="Create User"
                />
              </div>
            </div>
          </Dialog>
        </form>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    isOpen: state.createUser.isOpen,
    spinning: state.createUser.compileSuccess
  };
}

const formed = reduxForm({ form: 'create-user' })(CreateUser);
const connected = connect(
  mapStateToProps,
  {
    openOverlay,
    closeOverlay,
    createUser
  }
)(formed);

export default withRouter(connected);
