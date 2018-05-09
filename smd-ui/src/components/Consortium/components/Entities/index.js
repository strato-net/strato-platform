import React, { Component } from 'react';
import { Button, ButtonGroup, Card } from '@blueprintjs/core';
import { connect } from 'react-redux';
import InviteEntity from './InviteEntity';
import VoteConfirmation from './VoteConfirmation';
import './entities.css';

class Entities extends Component {

  constructor() {
    super();
    this.state = { isOpen: false, showAll: true }
    this.handleClose = this.handleClose.bind(this);
    this.handleVoteClick = this.handleVoteClick.bind(this);
  }

  handleClose() {
    this.setState({ isOpen: false });
  }

  handleVoteClick(voteType, votedFor) {
    this.setState({ isOpen: true, voteType, votedFor });
  }

  setFilter(filter) {
    this.setState({ showAll: !filter })
  }

  tableData(entities) {
    if (this.state.showAll) {
      return (<table className="pt-table pt-interactive pt-condensed pt-striped"
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
          {entities.map((entity, key) => {
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
                  {entity.status === 'Invited' && <span>
                    <Button
                      className="vote-btn pt-intent-primary pt-icon-thumbs-up"
                      onClick={() => this.handleVoteClick('in favor', entity.name)}
                    />
                    <Button
                      className="vote-btn pt-intent-primary pt-icon-thumbs-down"
                      onClick={() => this.handleVoteClick('against', entity.name)}
                    />
                    <VoteConfirmation
                      isOpen={this.state.isOpen}
                      handleClose={this.handleClose}
                      entityName={this.state.votedFor}
                      voteType={this.state.voteType}
                    />
                  </span>}
                </td>
                <td>
                  <Button>Connect</Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>)
    } else {
      return (<ul className="entity-list">
        {entities.map((entity, key) => {
          return (<li className="row" key={key}>
            <div className="col-md-4"><Card className="entity-name"><h4>{entity.name}</h4></Card></div>
            <div className="col-md-6"><Card className="entity-content"><ul>
              <li>Email Id: {entity.adminEmail}</li>
              <li>Invited By:</li>
            </ul></Card></div>
            <div className="col-md-2">
              <Button
                className="vote-btn pt-intent-primary pt-icon-thumbs-up"
                onClick={() => this.handleVoteClick('in favor', entity.name)}
              />
              <Button
                className="vote-btn pt-intent-primary pt-icon-thumbs-down"
                onClick={() => this.handleVoteClick('against', entity.name)}
              />
              <VoteConfirmation
                isOpen={this.state.isOpen}
                handleClose={this.handleClose}
                entityName={this.state.votedFor}
                voteType={this.state.voteType}
              />
            </div>
          </li>)
        })}
      </ul>)
    }
  }

  render() {
    const noOfEntities = this.props.entities.length
    const { showAll } = this.state;
    const entities = this.state.showAll
      ? this.props.entities
      : this.props.entities.filter(entity => entity.status === 'Invited');
    return (
      <div>
        <h4 className="col-md-2 heading">Entities</h4>
        <div className="text-right">
          <InviteEntity />
        </div>
        {(noOfEntities > 0)
          && <ButtonGroup minimal={true} large className="filter-btn">
            <Button
              className={showAll ? 'pt-active' : ''}
              onClick={() => this.setFilter(false)}
            >All</Button>
            <Button
              className={showAll ? '' : 'pt-active'}
              onClick={() => this.setFilter(true)}
            >Pending</Button>
          </ButtonGroup>}
        {(entities.length === 0) && <Card className="col-md-12 no-record">
          <h4>No records found</h4>
        </Card>}
        {(entities.length > 0) && this.tableData(entities)}
      </div>
    )
  }
}

export function mapStateToProps(state) {
  return {
    entities: state.createConsortium.consortium[0] ? state.createConsortium.consortium[0].entities : []
  };
}
const connected = connect(mapStateToProps)(Entities);

export default connected;