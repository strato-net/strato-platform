import React, { Component } from 'react';
import { openWalkThroughOverlay, closeWalkThroughOverlay } from './walkThrough.actions';
import { Button, Dialog, Intent } from '@blueprintjs/core';
import { Field, reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { faucetRequest } from '../Accounts/accounts.actions';
import CLI from '../CLI';
import CreateUser from '../CreateUser';
import Stepper from '../Stepper';
import Congrats from '../Congrats';
import './walkThrough.css';
import RequestTokenImage from './faucet.png';

class WalkThrough extends Component {
  constructor(props) {
    super(props);
    this.state = {
      isContinue: false,
      currentModal: 'CreateUser',
      step: 0,
    }
    this.handleBackToFaucet = this.handleBackToFaucet.bind(this);
  }

  componentDidMount() {
    mixpanelWrapper.track("faucet_loaded");
  }

  componentWillReceiveProps(nextProps) {
    if (this.state.currentModal !== 'CreateUser' && !nextProps.isLoggedIn)
      this.setState({ currentModal: 'CreateUser', step: 0 });
    if (!this.props.isLoggedIn && nextProps.isLoggedIn)
      this.setState({ currentModal: 'Faucet', step: 1 });
  }

  submit = (values) => {
    mixpanelWrapper.track('faucet_submit_click');
    let mailto = `mailto:product@blockapps.net?subject=Faucet Request&body=${values.building}. My address is ${this.props.currentUser.accountAddress}.`;
    window.location.href = mailto;
    this.setState({ isContinue: true });
  }

  faucetContent() {
    return (
      <div>
        <div className="pt-dialog-body faucet-container">
          <div className="pt-form-group">
            <div className="faucet-title">
              <h4>Request STRATO tokens to use and launch apps.</h4>
            </div>

            <div className="faucet-body">   
              <img src={RequestTokenImage} alt="Request Token" className="side-image"/>

              <div className="pt-form-group pt-intent-danger faucet-form">
                <label className="pt-label" htmlFor="input-b">
                  Using and launching apps requires tokens. Tell us what you are building so we can fund you.
                </label>
                <div className="pt-form-content">
                  <Field
                    name="building"
                    component="textarea"
                    type="text"
                    placeholder="I am building..."
                    className="pt-input form-width"
                    tabIndex="3"
                    required
                  />
                  <div className="pt-form-helper-text">{this.props.errors && this.props.errors.building}</div>
                </div>
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
            <Button
              intent={Intent.PRIMARY}
              onClick={this.props.handleSubmit(this.submit)}
              text="SEND PRE-GENERATED EMAIL"
              disabled={this.props.submitting}
            />
            <Button text="EMAIL SENT?"
              intent={Intent.PRIMARY}
              onClick={() => {
                mixpanelWrapper.track('faucet_close_click');
                this.setState({ currentModal: "CLI", isContinue: false, step: 2 });
                // Faucet account using jwt tobe done
                this.props.faucetRequest(this.props.currentUser.accountAddress);
              }} disabled={!this.state.isContinue} />
          </div>
        </div>
      </div>
    )
  }

  handleBackToFaucet() {
    this.setState({ currentModal: "Faucet", step: 1 });
  }

  render() {
    let title;
    if (this.state.currentModal === "CreateUser")
      title = 'Create STRATO Developer ID';
    else if (this.state.currentModal === "Faucet")
      title = 'Request Tokens';
    else
      title = 'Download CLI Tool';

    return (
      <div>
        <form>
          <Dialog
            isOpen={this.props.isWalkThroughOpen}
            onClose={() => {
              mixpanelWrapper.track('faucet_close_click');
              this.props.closeWalkThroughOverlay();
            }}
            title={title}
            className="pt-dark dialog"
            canOutsideClickClose={false}
            canEscapeKeyClose={this.state.currentModal === "CreateUser"}
            isCloseButtonShown={this.state.currentModal === "CreateUser"}
          >
            <Stepper step={this.state.step} />
            {this.state.currentModal === "CreateUser" && <CreateUser />}

            {this.state.currentModal === "Faucet" && this.faucetContent()}

            {this.state.currentModal === "CLI" && <CLI handleBack={this.handleBackToFaucet} handleContinue={
                () => this.setState({ currentModal: "Completed", step: 3 })} />}

            {this.state.currentModal === "Completed" &&
              <Congrats closeWalkThroughOverlay={this.props.closeWalkThroughOverlay} handleBack={
                () => this.setState({ currentModal: "CLI", step: 2 })} />}

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
    currentUser: state.user.currentUser,
    isLoggedIn: state.walkThrough.isLoggedIn,
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