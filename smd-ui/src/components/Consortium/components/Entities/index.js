import React, { Component } from 'react';
import { Button } from '@blueprintjs/core';
import { connect } from 'react-redux';
import InviteEntity from './InviteEntity';
import VoteConfirmation from './VoteConfirmation';
import './entities.css';

class Entities extends Component {

  constructor() {
    super();
    this.state = { isOpen: false }
    this.handleClose = this.handleClose.bind(this);
    this.handleVoteClick = this.handleVoteClick.bind(this);
  }

  handleClose() {
    this.setState({ isOpen: false });
  }

  handleVoteClick(voteType) {
    this.setState({ isOpen: true, voteType });

  }

  tableData() {
    const entities = this.props.createConsortium.consortium[0]
      ? this.props.createConsortium.consortium[0].entities
      : []
    if (entities.length) {
      return entities.map((entity, key) => {
        return (
          <tr key={key}>
            <td>
              {entity.name}
            </td>
            <td>
              {entity.nodes ? entity.nodes.length : 0}
            </td>
            <td>
              {entity.users ? entity.users.length : 0}
            </td>
            <td>
              {entity.status}
              {entity.status === 'Pending' && <span>
                <Button
                  className="vote-btn pt-intent-primary pt-icon-thumbs-up"
                  onClick={() => this.handleVoteClick('in favor')}
                />
                <Button
                  className="vote-btn pt-intent-primary pt-icon-thumbs-down"
                  onClick={() => this.handleVoteClick('against')}
                />
                <VoteConfirmation
                  isOpen={this.state.isOpen}
                  handleClose={this.handleClose}
                  entityName={entity.name}
                  voteType={this.state.voteType}
                />
              </span>}
            </td>
            <td>
              <Button>Connect</Button>
            </td>
          </tr>
        )
      })
    } else {
      return (
        <tr><td colSpan={5}>No records found</td></tr>
      )
    }
  }

  render() {
    return (
      <div>
        <div className="text-right">
          <InviteEntity />
        </div>
        <table className="pt-table pt-interactive pt-condensed pt-striped"
          style={{ width: '100%' }}>
          <thead>
            <tr>
              <th><h5>Member</h5></th>
              <th><h5>Nodes</h5></th>
              <th><h5>Users</h5></th>
              <th><h5>Status</h5></th>
              <th><h5>Privacy</h5></th>
            </tr>
          </thead>

          <tbody>
            {this.tableData()}
          </tbody>
        </table>
      </div>
    )
  }
}

export function mapStateToProps(state) {
  return {
    createConsortium: state.createConsortium
  };
}
const connected = connect(mapStateToProps)(Entities);

export default connected;