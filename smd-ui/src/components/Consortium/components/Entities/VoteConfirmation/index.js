import React, { Component } from 'react';
import { Dialog, Button, Intent } from '@blueprintjs/core';
import './voteConfirmation.css';

class VoteConfirmation extends Component {
  render() {
    return (
      <div>
        <Dialog
          isOpen={this.props.isOpen}
          onClose={() => {
            this.props.handleClose();
          }}
          title="Voting Confirmation"
          className="pt-dark dialog"
        >
          <div className="voting-confirmation">
            <h4>Confirmation</h4>
            <p>You are voting {this.props.voteType}</p>
            <h5 className="user">{this.props.entityName}</h5>
            <Button
              intent={Intent.PRIMARY}
              text="Submit"
              type="submit"
            />
          </div>
        </Dialog>
      </div>
    )
  }
}

export default VoteConfirmation;