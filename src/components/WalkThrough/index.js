import React, { Component } from 'react';
import { openWalkThroughOverlay, closeWalkThroughOverlay } from './walkThrough.actions';
import { Dialog } from '@blueprintjs/core';
import { reduxForm } from 'redux-form';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { faucetRequest } from '../Accounts/accounts.actions';
import CLI from '../CLI';
import CreateUser from '../CreateUser';
import Stepper from '../Stepper';
import Congrats from '../Congrats';
import Faucet from '../Faucet';
import './walkThrough.css';

class WalkThrough extends Component {
  constructor(props) {
    super(props);
    this.state = {
      currentModal: 'CreateUser',
      step: 0,
      isBackClicked: false,
    }
    this.handleBackToFaucet = this.handleBackToFaucet.bind(this);
    this.handleEmailSentClick = this.handleEmailSentClick.bind(this);
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

  handleBackToFaucet() {
    this.setState({ currentModal: "Faucet", step: 1, isBackClicked: true });
  }

  handleEmailSentClick() {
    mixpanelWrapper.track('faucet_close_click');
    this.setState({ currentModal: "Completed", isBackClicked: false });
    // Faucet account using jwt tobe done
    this.props.faucetRequest(this.props.currentUser.accountAddress);
  }

  dialogContent() {
    switch (this.state.currentModal) {
      case "CreateUser":
        return <CreateUser />
        break;
      case "Faucet":
        return <Faucet
          errors={this.props.errors}
          handleSubmit={this.props.handleSubmit}
          submitting={this.props.submitting}
          faucetRequest={this.props.faucetRequest}
          currentUser={this.props.currentUser}
          handleEmailSentClick={this.handleEmailSentClick}
          isWalkThrough={true}
          isBackClicked={this.state.isBackClicked}
        />
        break;
      case "Completed":
        return <Congrats
          handleBack={() => this.setState({ currentModal: "Faucet", step: 1, isBackClicked: true })}
          handleContinue={() => this.setState({ currentModal: "CLI", step: 2 })} />
        break;
      case "CLI":
        return <CLI
          handleBack={this.handleBackToFaucet}
          closeWalkThroughOverlay={this.props.closeWalkThroughOverlay} />
        break;
    }
  }

  render() {
    let title;
    if (this.state.currentModal === "CreateUser")
      title = 'Create STRATO Developer ID';
    else if (this.state.currentModal === "Faucet")
      title = 'Request Tokens';
    else if (this.state.currentModal === "CLI")
      title = 'Download CLI Tool';
    else
      title = 'Congratulations!'

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
            {this.dialogContent()}
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