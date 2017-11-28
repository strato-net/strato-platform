import React, {Component} from 'react';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import {Text} from '@blueprintjs/core';
import './peersCard.css';
class PeersCard extends Component {


  render() {
    const node = this.props.node;
    const peers = node.peers ? Object.getOwnPropertyNames(node.peers) : [];
    let className = 'pt-card pt-elevation-2';
    return (
      <div className={className}>
        <h5>Peers {`(${peers.length})`}</h5>
        {peers.length > 0
          ? peers.map((peer, index) => {
            return (
              <div key={index} className="row node-peers">
                <div className="col-xs-3">
                  <small>IP:
                  </small>
                </div>
                <div className="col-xs-9">
                  <Text ellipsize={true}>
                    <small>{peer}</small>
                  </Text>
                </div>
                <div className="col-xs-3">
                  <small>Port:
                  </small>
                </div>
                <div className="col-xs-9">
                  <Text ellipsize={true}>
                    <small>{node.peers[peer]}</small>
                  </Text>
                </div>
              </div>
            )
          })
          : <Text ellipsize={true}>
            <small>No peers</small>
          </Text>}
      </div>
    );
  }
}

function mapStateToProps(state) {
  return { node: state.node };
}

export default withRouter(connect(mapStateToProps, null)(PeersCard));
