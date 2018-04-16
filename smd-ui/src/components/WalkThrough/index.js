import React, { Component } from 'react';
import { closeWalkThroughOverlay } from './walkThrough.actions';
import { Dialog } from '@blueprintjs/core';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import CLI from '../CLI';
import CreateUser from '../CreateUser';
import Stepper from '../Stepper';
import Congrats from '../Congrats';
import VerifyAccount from '../VerifyAccount';
import CreatePassword from '../CreatePassword';
import './walkThrough.css';
import { faucetRequest } from '../Accounts/accounts.actions';

class WalkThrough extends Component {
  constructor(props) {
    super(props);
    this.state = {
      currentModal: 'CreateUser',
      step: 0
    }
  }

  componentDidMount() {
    mixpanelWrapper.track("faucet_loaded");
  }

  componentWillReceiveProps(nextProps) {
    if (this.state.currentModal !== 'CreateUser' && !nextProps.isLoggedIn)
      this.setState({ currentModal: 'CreateUser', step: 0 });
    if (nextProps.firstTimeUser)
      this.setState({ currentModal: 'VerifyAccount', step: 1 });
    if (nextProps.isTempPasswordVerified)
      this.setState({ currentModal: 'CreatePassword', step: 2 });
    if (!this.props.isLoggedIn && nextProps.isLoggedIn)
      this.setState({ currentModal: 'Completed', step: 3 });
  }

  handleContinue = () => {
    this.setState({ currentModal: "CLI", step: 4 })
    this.props.faucetRequest(this.props.currentUser.accountAddress);
  }

  dialogContent() {
    switch (this.state.currentModal) {
      case "CreateUser":
        return <CreateUser />
      case "VerifyAccount":
        return <VerifyAccount />
      case "CreatePassword":
        return <CreatePassword />
      case "CLI":
        return <CLI
          closeWalkThroughOverlay={this.props.closeWalkThroughOverlay} />
      default:
        return <Congrats handleContinue={this.handleContinue} />
    }
  }

  dialogTitle() {
    switch (this.state.currentModal) {
      case "CreateUser":
        return 'Link Account to STRATO Testnet';
      case "VerifyAccount":
        return 'Password Verification';
      case "CreatePassword":
        return 'Set Permanent Password'
      case "CLI":
        return 'Download CLI Tool';
      default:
        return 'Congratulations!'
    }
  }

  render() {
    return (
      <div>
        <form>
          <Dialog
            isOpen={this.props.isWalkThroughOpen}
            onClose={() => {
              mixpanelWrapper.track('faucet_close_click');
              this.props.closeWalkThroughOverlay();
            }}
            title={this.dialogTitle()}
            className="pt-dark dialog walk-through"
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
  return {
    isWalkThroughOpen: state.walkThrough.isWalkThroughOpen,
    currentUser: state.user.currentUser,
    isLoggedIn: state.walkThrough.isLoggedIn,
    firstTimeUser: state.user.firstTimeUser,
    isTempPasswordVerified: state.verifyAccount.isTempPasswordVerified,
  };
}

const connected = connect(
  mapStateToProps,
  {
    closeWalkThroughOverlay,
    faucetRequest
  }
)(WalkThrough);

export default withRouter(connected);