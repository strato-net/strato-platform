import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter, Link } from 'react-router-dom';
import { Field, reduxForm } from 'redux-form';
import Dropzone from 'react-dropzone';

class LaunchPad extends Component {

  renderDropzoneInput = (field) => {
    const touchedAndHasErrors = field.meta.touched && field.meta.error
    return (
      <div className="dropzoneContainer text-center">
        <Dropzone
          className={ touchedAndHasErrors ? "dropzone" : "dropzoneActive"}
          activeClassName="dropzoneActive"
          rejectClassName="dropzoneRejected"
          name={field.name}
        >
          <p style={{'float': 'left'}}>Drop the package here or click to browse</p>
        </Dropzone>
        {touchedAndHasErrors && <span className="error">{field.meta.error}</span>}
      </div>
    );
  };


  render() {
    return (
      <div className="container-fluid pt-dark">
        <div className="row smd-pad-12">
          <div className="col-sm-10">
            <h3>Launchpad</h3>
          </div>
          <div className="col-sm-2 text-right smd-pad-vertical-12">
            <Link to="/apps">
              <button
                type="button"
                className="pt-button pt-intent-primary"
              >
                Apps
              </button>
            </Link>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <div className="pt-card">
              <h4>Enter application details</h4>
              <hr />
              <div className="row smd-pad-top-12">
                <div className="col-sm-2 text-right">
                  <label className="pt-label smd-pad-vertical-4" htmlFor="appName">
                    Username
                  </label>
                </div>
                <div className="col-sm-10">
                  <Field
                    name="appUsername"
                    className="pt-input smd-input-width"
                    component="input"
                    type="tect"
                    placeholder="Username"
                    dir="auto"
                    required
                  />
                </div>
              </div>
              <div className="row">
                <div className="col-sm-2 text-right">
                  <label className="pt-label smd-pad-vertical-4" htmlFor="appName">
                    User Address
                  </label>
                </div>
                <div className="col-sm-10">
                  <Field
                    name="appUserAddress"
                    className="pt-input smd-input-width"
                    component="input"
                    type=""
                    placeholder="User Address"
                    dir="auto"
                    required
                  />
                </div>
              </div>
              <div className="row">
                <div className="col-sm-2 text-right">
                  <label className="pt-label smd-pad-vertical-4" htmlFor="appName">
                    Password
                  </label>
                </div>
                <div className="col-sm-10">
                  <Field
                    name="appPassword"
                    className="pt-input smd-input-width"
                    component="input"
                    type="password"
                    placeholder="User Password"
                    dir="auto"
                    required
                  />
                </div>
              </div>
              <div className="row">
                <div className="col-sm-2 text-right">
                  <label className="pt-label smd-pad-vertical-4" htmlFor="appName">
                    Package
                  </label>
                </div>
                <div className="col-sm-10">
                  <Field
                    className="pt-input"
                    name="appPackage"
                    component={this.renderDropzoneInput}
                    dir="auto"
                    title="Package"
                    required
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

}

function mapStateToProps(state) {
  return {
  };
}

function validate(values) {
  const errors = {};
  return errors;
}

const CREATE_APP_FORM = 'create-app';

const formed = reduxForm({form:CREATE_APP_FORM, validate})(LaunchPad);

export default withRouter(
  connect( mapStateToProps,
    {
    }
  )(formed)
);
