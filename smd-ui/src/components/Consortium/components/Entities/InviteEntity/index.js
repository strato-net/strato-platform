import React, { Component } from "react";
import { connect } from "react-redux";
import { Dialog, Button } from "@blueprintjs/core";
import {
  openInviteEntityModal,
  closeInviteEntityModal,
  resetError
} from "../entities.actions";
import InviteForm from "./InviteForm";
import './inviteEntity.css';
import { toasts } from "../../../../Toasts";

class InviteEntity extends Component {

  componentWillReceiveProps(nextProps) {
    if (nextProps.message) {
      toasts.show({ message: nextProps.message });
      this.props.resetError();
    }
  }

  render() {
    return (
      <span>
        <Button
          onClick={() => {
            this.props.openInviteEntityModal();
          }}
          className="pt-intent-primary pt-icon-add invite-button"
          text="Invite Entity"
        />

        <Dialog
          isOpen={this.props.isOpen}
          onClose={() => {
            this.props.closeInviteEntityModal();
          }}
          title="Invite Entity"
          className="pt-dark dialog"
        >
          <InviteForm />
        </Dialog>
      </span>
    );
  }
}

export function mapStateToProps(state) {
  return {
    isOpen: state.entities.isOpen,
    message: state.entities.message
  };
}

export default connect(mapStateToProps, {
  openInviteEntityModal,
  closeInviteEntityModal,
  resetError
})(InviteEntity);
