import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Collapse } from '@blueprintjs/core';
import './nodeCard.css';
import PeersCard from '../PeersCard';
import HexText from '../HexText';
import { subscribeRoom, unSubscribeRoom } from '../../sockets/socket.actions'
import {
  GET_PEERS
} from '../../sockets/rooms'

class NodeCard extends Component {

  constructor() {
    super()
    this.state = {
      isOpen: false
    }
  }

  componentDidMount() {
    this.props.subscribeRoom(GET_PEERS)
  }

  componentWillUnmount() {
    this.props.unSubscribeRoom(GET_PEERS)
  }

  handleClick = () => {
    this.setState({ isOpen: !this.state.isOpen });
  };

  render() {
    const node = this.props.node;
    const peers = node.peers ? Object.getOwnPropertyNames(node.peers) : [];
    const blockNumber = this.props.dashboard.lastBlockNumber;
    let className = 'pt-card pt-elevation-2 node-success pt-interactive';
    let arrowIcon = 'col-xs-3 text-right pt-icon-standard '
    arrowIcon += this.state.isOpen ? 'pt-icon-caret-up' : 'pt-icon-caret-down'

    return (
      <div>
        <div className={className} onClick={this.handleClick}>
          <div className="row">
            <div className="col-xs-9">
              <h5>{node.name}</h5>
            </div>
            <span className={arrowIcon}></span>
          </div>
          <div className="row pt-text-muted">
            <div className="col-xs-3">
              <small>Block</small>
            </div>
            <div className="col-xs-9">
              <small>{blockNumber}</small>
            </div>
          </div>
          <div className="row pt-text-muted">
            <div className="col-xs-3">
              <small>Peers</small>
            </div>
            <div className="col-xs-9">
              <small>{peers.length}</small>
            </div>
          </div>
        </div>
        <Collapse isOpen={this.state.isOpen}>
          <PeersCard />
        </Collapse>
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    dashboard: state.dashboard,
    node: state.node
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    {
      subscribeRoom,
      unSubscribeRoom,
    }
  )(NodeCard)
);