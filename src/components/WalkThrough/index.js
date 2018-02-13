import React, { Component } from 'react';
import { openWalkThroughOverlay, closeWalkThroughOverlay } from './walkThrough.actions';
import { Button, Dialog, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { downloadPDFFile } from '../../lib/fileHandler';
import cli from '../../cli.pdf';
import { faucetRequest } from '../Accounts/accounts.actions';
import './walkThrough.css';

class WalkThrough extends Component {
  constructor(props) {
    super(props);
    this.state = {
      isContinue: false,
      initialModal: 'Faucet'
    }
  }

  componentDidMount() {
    mixpanelWrapper.track("faucet_loaded");
  }

  submit = (values) => {
    mixpanelWrapper.track('faucet_submit_click');
    let mailto = `mailto:product@blockapps.net?subject=Faucet Request&body=${values.building}. My address is <USER ADDRESS>.`;
    window.location.href = mailto;
    this.setState({ isContinue: true });
  }

  faucetContent() {
    return (
      <div>
        <div className="pt-dialog-body">
          <div className="pt-form-group">
            <div className="pt-form-group pt-intent-danger">
              <div className="pt-form-content">
                Using and launching apps requires tokens. Please complete the form below to email us your token request.
                  </div>
            </div>

            <div className="pt-form-group pt-intent-danger">
              <label className="pt-label" htmlFor="input-b">
                What are you building?
                  </label>
              <div className="pt-form-content">
                <Field
                  name="building"
                  component="textarea"
                  type="text"
                  placeholder="What are you building?"
                  className="pt-input form-width"
                  tabIndex="3"
                  required
                />
                <div className="pt-form-helper-text">{this.props.errors && this.props.errors.building}</div>
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
            <Button text="Continue"
              intent={Intent.PRIMARY}
              onClick={() => {
                mixpanelWrapper.track('faucet_close_click');
                this.setState({ initialModal: "CLI", isContinue: false });
                // Faucet account using jwt tobe done
                this.props.faucetRequest('19ec7fac17c24ed9482790b15de678af6c580617');
              }} disabled={!this.state.isContinue} />
            <Button
              intent={Intent.PRIMARY}
              onClick={this.props.handleSubmit(this.submit)}
              text="Submit"
              disabled={this.props.submitting}
            />
          </div>
        </div>
      </div>
    )
  }

  CLIContent() {
    return (
      <div>
        <div className="pt-dialog-body">
          <div className="pt-form-group">
            <div className="pt-form-group pt-intent-danger">
              <div className="pt-form-content">
                The ​ bloc CLI​ is designed to make it easy for developers to download, deploy, and manage their
                apps from the command line. The ​ bloc CLI​ is a Node.js module that will allow users to download,
                zip, and deploy ​ App Bundles​ and services to STRATO, as well as to monitor their account
                balance. The ​ bloc CLI​ is intended to be used in conjunction with the ​ STRATO Public Web App.
                <a onClick={() => {
                  mixpanelWrapper.track('Add_App_click');
                  downloadPDFFile('cli.pdf', cli)
                }}> Click to download PDF </a>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-dialog-footer">
          <div className="pt-dialog-footer-actions">
            <Button text="Back" onClick={() => {
              mixpanelWrapper.track('faucet_close_click');
              this.setState({ initialModal: "Faucet" });
            }} />
            <Button
              intent={Intent.PRIMARY}
              onClick={() => {
                this.setState({ initialModal: "Faucet" });
                this.props.closeWalkThroughOverlay();
              }}
              text="Finish"
            />
          </div>
        </div>
      </div>
    )
  }

  render() {
    return (
      <div>
        <form>
          <Dialog
            isOpen={this.props.isWalkThroughOpen}
            onClose={this.props.closeFaucetOverlay}
            title={this.state.initialModal === "Faucet" ? "STRATO Token Request Form" : "How to Deploy an App on STRATO"}
            className="pt-dark"
          >
            {this.state.initialModal === "Faucet" && this.faucetContent()}

            {this.state.initialModal === "CLI" && this.CLIContent()}

          </Dialog>
        </form>
      </div>
    );
  }
}

export function mapStateToProps(state) {
  let errors = { errors: undefined };

  if (state.form && state.form["walkThrough"]) {
    errors = { errors: state.form["walkThrough"].syncErrors }
  }
  return {
    isWalkThroughOpen: state.walkThrough.isWalkThroughOpen,
    ...errors
  };
}

export function validate(values) {
  const errors = {};
  if (values.building === undefined && !values.building) {
    errors.building = "Please tell us what are you building";
  }

  return errors;
}

const formed = reduxForm({ form: 'walkThrough', validate })(WalkThrough);
const connected = connect(
  mapStateToProps,
  {
    openWalkThroughOverlay,
    closeWalkThroughOverlay,
    faucetRequest
  }
)(formed);

export default withRouter(connected);