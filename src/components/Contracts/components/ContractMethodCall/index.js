import React, {Component} from 'react';
import { Button, Dialog } from '@blueprintjs/core';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanel from 'mixpanel-browser';

import {
  methodCallOpenModal,
  methodCallCloseModal
} from './contractMethodCall.actions';

import './contractMethodCall.css';

class ContractMethodCall extends Component {

  handleOpenModal = (e) => {
    e.stopPropagation();
    e.preventDefault();
    this.props.methodCallOpenModal(this.props.lookup);
  }

  handleCloseModal = (e) => {
    e.stopPropagation();
    e.preventDefault();
    this.props.methodCallCloseModal(this.props.lookup);
  }

  render() {
    return (
      <div>
        <Button
          className="pt-minimal pt-small pt-intent-primary"
          onClick={this.handleOpenModal}
        >
          Call Method
        </Button>
        <Dialog
          isOpen={this.props.isOpen}
          onClose={this.handleCloseModal}
          title="Call "
          className="pt-dark"
        >
          <div className="pt-dialog-body">
            Content goes here!
          </div>
        </Dialog>
      </div>
    );
  }
}

function mapStateToProps(state, ownProps) {
  return {
    isOpen: state.methodCall.modals
      && state.methodCall.modals[ownProps.lookup]
      && state.methodCall.modals[ownProps.lookup].isOpen
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    {
      methodCallOpenModal,
      methodCallCloseModal
    }
  )
  (ContractMethodCall)
);
