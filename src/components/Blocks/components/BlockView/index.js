import React, {Component} from 'react';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import {Button, Text} from '@blueprintjs/core';
import * as moment from 'moment';

class BlockView extends Component {


  render() {
    const blockNumber = this.props.match.params.block;
    const block = this.props.block;
    return (
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-sm-9">
            <div className="h3">Block #{blockNumber}</div>
          </div>
          <div className="col-sm-3 smd-pad-16 text-right">
            <Button
              onClick={(e) => this.props.history.goBack()}
              className="pt-icon-arrow-left"
              text="Back"
            />
          </div>
        </div>
        {block === undefined ?
          <div className="row">
            <div className="col-sm-12">
              <div className="pt-card">
                  <table>
                    <tbody>
                    <tr colSpan={2}>No data</tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            :
            <div className="row">
              <div className="col-sm-12">
                <div className="pt-card">
                  <table className="pt-table pt-str">
                    <thead>
                    <tr>
                      <th>Field</th>
                      <th>Value</th>
                    </tr>
                    </thead>
                    <tbody>
                    <tr>
                      <td>Parent Hash</td>
                      <td>
                        <Text ellipsize={true}>
                          <small>{block.blockData.parentHash}</small>
                        </Text>
                      </td>
                    </tr>
                    <tr>
                      <td>Difficulty</td>
                      <td>
                        <small>
                          <Text ellipsize={true}>
                            {block.blockData.difficulty}
                          </Text>
                        </small>
                      </td>
                    </tr>
                    <tr>
                      <td>Nonce</td>
                      <td>
                        <small>
                          <Text ellipsize={true}>
                            {block.blockData.nonce}
                          </Text>
                        </small>
                      </td>
                    </tr>
                    <tr>
                      <td>Coinbase</td>
                      <td>
                        <small>
                          <Text ellipsize={true}>
                            {block.blockData.coinbase}
                          </Text>
                        </small>
                      </td>
                    </tr>
                    <tr>
                      <td>State Root</td>
                      <td>
                        <small>
                          <Text ellipsize={true}>
                            {block.blockData.stateRoot}
                          </Text>
                        </small>
                      </td>
                    </tr>
                    <tr>
                      <td>Transactions Root</td>
                      <td>
                        <small>
                          <Text ellipsize={true}>
                            {block.blockData.transactionsRoot}
                          </Text>
                        </small>
                      </td>
                    </tr>
                    <tr>
                      <td>Timestamp</td>
                      <td>
                        <small>
                          <Text ellipsize={true}>
                            {moment(block.blockData.timestamp).format('YYYY-MM-DD hh:mm:ss A')}
                          </Text>
                        </small>
                      </td>
                    </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          }

      </div>
    );
  }
}

function mapStateToProps(state, ownProps) {
  const blockNumber = Number(ownProps.match.params.block);
  return {
    block: state.blockData.blockData.filter((val) => {
      return val.blockData.number === blockNumber
    })[0],
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    {}
  )(BlockView)
);
