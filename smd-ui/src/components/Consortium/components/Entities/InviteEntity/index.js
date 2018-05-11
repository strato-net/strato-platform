import React, { Component } from "react";
import { connect } from "react-redux";
import { Dialog, Button } from "@blueprintjs/core";
import {
  openInviteEntityModal,
  closeInviteEntityModal
} from "../entities.actions";
import InviteForm from "./InviteForm";

class InviteEntity extends Component {
  render() {
    return (
      <div>
        <Button
          onClick={() => {
            this.props.openInviteEntityModal();
          }}
          className="pt-intent-primary pt-icon-add smd-margin-16"
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
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    isOpen: state.entities.isOpen
  };
}

export default connect(mapStateToProps, {
  openInviteEntityModal,
  closeInviteEntityModal
})(InviteEntity);
