import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Field, reduxForm } from 'redux-form';
import { Button } from '@blueprintjs/core';
import mixpanelWrapper from '../../../lib/mixpanelWrapper';
import { firstTimeLoginValidate } from '../validate.js';
import { openWalkThroughOverlay } from '../../WalkThrough/walkThrough.actions';
import { firstTimeLogin } from '../../User/user.actions';

class FirstTimeUser extends Component {

  constructor() {
    super();
    this.state = { errors: null };
  }

  errorMessageFor(fieldName) {
    if (this.state.errors && this.state.errors[fieldName]) {
      return this.state.errors[fieldName];
    }
    return null;
  }

  submit = (values) => {
    let errors = firstTimeLoginValidate(values);
    this.setState({ errors });

    if (JSON.stringify(errors) === JSON.stringify({})) {
      this.props.firstTimeLogin(values.email);
    }
  }

  render () {
    return (
      <div>
        <div className="pt-dialog-body">
          <div className="pt-form-group">
            <div className="pt-form-group pt-intent-danger">
              <label className="pt-label" htmlFor="input-a">
                Email Address
              </label>
              <div className="pt-form-content">
                <Field
                  name="email"
                  className="pt-input form-width smd-full-width"
                  placeholder="Email Address"
                  component="input"
                  type="email"
                  required
                /> <br />
                <span className="error-text">{this.errorMessageFor('email')}</span>
              </div>
            </div>
          </div>
          <div>
            <div className="col-sm-3"></div>
            <div className="col-sm-3"></div>
            <div className="col-sm-3"></div>
          </div>
        </div>

        <div className="pt-dialog-footer text-center">
          <div className="pt-dialog-footer-actions">
            <Button onClick={() => {
              mixpanelWrapper.track('create_user_open_click');
              this.props.closeLoginOverlay();
              this.props.openWalkThroughOverlay(false);
            }} text="Create User" className="pt-icon-add" />
            <Button
              type="button"
              onClick={this.props.handleSubmit(this.submit)}
              text='Submit'
              disabled={this.props.spinning}
              className="pt-intent-primary pt-icon-log-in"
            />
          </div>
        </div>
      </div>
    )
  }
}

const formed = reduxForm({ form: 'firstTimeUserLogin' })(FirstTimeUser);

function mapStateToProps(state) {
  return { spinning: state.user.spinning };
}

const connected = connect(mapStateToProps, { openWalkThroughOverlay, firstTimeLogin })(formed);

export default withRouter(connected);
