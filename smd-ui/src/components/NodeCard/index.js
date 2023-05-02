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
            <div className='col-sm-6'>

              <h3>Peers ({peers.length})</h3>
              <span className={arrowIcon}>{this.state.isOpen ? "Close" : "Expand"}</span>
            </div>
          </div>
        <hr/>
        <Collapse isOpen={this.state.isOpen}>
          <PeersCard />
        </Collapse>
        </div>
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