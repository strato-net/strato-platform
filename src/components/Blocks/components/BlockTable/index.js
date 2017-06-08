import React, {Component} from 'react';
import {connect} from 'react-redux';
import {fetchBlockData} from '../../../BlockData/block-data.actions';
import {withRouter} from 'react-router-dom';
import {Text, Position, Tooltip} from '@blueprintjs/core';
import * as moment from 'moment';

class BlockTable extends Component {

  componentDidMount() {
    this.props.fetchBlockData();
    this.startPoll();
  }

  componentWillUnmount() {
    clearTimeout(this.timeout)
  }

  startPoll() {
    const fetchTx = this.props.fetchBlockData;
    this.timeout = setInterval(function () {
      fetchTx();
    }, 5000);
  }

  render() {
    const history = this.props.history;

    function handleClick(blockNumber) {
      history.push('/blocks/' + blockNumber);
    }

    let blockRows = this.props.blockData.map(
      function (block) {
        return (
          <tr key={block.blockData.number} onClick={() => {
            handleClick(block.blockData.number)
          }}>
            <td width="16.66%">
              <small>{block.blockData.number}</small>
            </td>
            <td width="16.66%">
              <Text ellipsize={true}>
                <Tooltip tooltipClassName="smd-padding-8" content={block.blockData.parentHash} position={Position.TOP_LEFT}>
                  <small>{block.blockData.parentHash}</small>
                </Tooltip>
              </Text>
            </td>
            <td width="16.66%">
              <Text ellipsize={true}>
                <small>
                  {block.blockData.difficulty}
                </small>
              </Text>
            </td>
            <td width="16.66%">
              <Text ellipsize={true}>
                <small>
                  {block.blockData.nonce}
                </small>
              </Text>
            </td>
            <td width="16.66%">
              <Text ellipsize={true}>
                <Tooltip tooltipClassName="smd-padding-8" content={block.blockData.coinbase} position={Position.TOP_LEFT}>
                  <small>
                    {block.blockData.coinbase}
                  </small>
                </Tooltip>
              </Text>
            </td>
            <td width="16.66%">
              <Text ellipsize={true}>
                <small>
                  {moment(block.blockData.timestamp).format('YYYY-MM-DD hh:mm:ss A')}
                </small>
              </Text>
            </td>
          </tr>
        )
      }
    );

    return (
      <div className="row">
        <div className="col-sm-12">
          <div className="pt-card pt-dark pt-elevation-2">
            <table className="pt-table pt-interactive pt-condensed pt-striped"
                   style={{tableLayout: 'fixed', width: '100%'}}>
              <thead>
              <tr>
                <th width="16.66%"><h5>Block Number</h5></th>
                <th width="16.66%"><h5>Parent Hash</h5></th>
                <th width="16.66%"><h5>Difficulty</h5></th>
                <th width="16.66%"><h5>Nonce</h5></th>
                <th width="16.66%"><h5>Coinbase</h5></th>
                <th width="16.66%"><h5>Timestamp</h5></th>
              </tr>
              </thead>

              <tbody>
              {blockRows}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    blockData: state.blockData.blockData,
  };
}

export default withRouter(connect(mapStateToProps, {fetchBlockData})(BlockTable));
