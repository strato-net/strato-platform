import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button } from '@blueprintjs/core';
import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import HexText from '../../../HexText';
import { parseDateFromString } from '../../../../lib/dateUtils';
import { executeQuery, getTransactionResultRequest} from '../../../QueryEngine/queryEngine.actions';
import { RESOURCE_TYPES } from '../../../QueryEngine/queryTypes';

class TransactionView extends Component {
  componentDidMount() {
    this.props.executeQuery(RESOURCE_TYPES.transaction, this.props.query, this.props.selectedChain);
    this.props.getTransactionResultRequest(this.props.match.params.hash);
  }
  render() {
    const history = this.props.history;
    const hash = this.props.match.params.hash;
    const tx = this.props.tx ? this.props.tx : {};
    if (!Object.keys(tx).length) history.push(`/transactions`);

    let cardIntent = ''
    switch (this.props.txResult) {
      case 'Success':
          cardIntent = 'pt-intent-success'
          break;
      case 'Pending':
          cardIntent = 'pt-intent-warning'
          break;
      case 'ExecutionFailure':
          cardIntent = 'pt-intent-danger'
          break
      default:
          break
    }
    const parseArgs = (args) => {
      const cleaned = args.substring(1, args.length - 1)
      return cleaned.split(',')
    }
    const parsedArgs = tx.metadata && tx.metadata.args ? parseArgs(tx.metadata.args) : [] 
    return (
      <div className="container-fluid pt-dark ">
        
        <div className="row">
          <div className="col-sm-9">
            <div className="h3">
              <HexText value={hash} shorten={false} classes="smd-pad-2" />
            </div>
          </div>
          <div className="col-sm-3 smd-pad-16 text-right">
            <Button
              onClick={(e) => { mixpanelWrapper.track("transactions_view_go_back_click"); this.props.history.goBack() }}
              className="pt-icon-arrow-left"
              text="Back"
            />
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <div className={`pt-card pt-callout ${cardIntent}`}>

              <table className="pt-table pt-str">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Result</strong></td>
                    <td>{this.props.txResult ? this.props.txResult : ""}</td>
                  </tr>
                  {
                      this.props.txResult === 'ExecutionFailure' &&
                    <tr>
                      <td><strong>Error Message</strong></td>
                      <td>
                        <pre>
                        {this.props.txResultMessage || "Unknown Error"}
                        </pre>
                        </td>
                    </tr>
                  }
                  <tr>
                    <td><strong>Type</strong></td>
                    <td>{tx.transactionType ? tx.transactionType : "Unknown TX Type"}</td>
                  </tr>
                  <tr>
                    <td><strong>From</strong></td>
                    <td>{tx.from === undefined ? '' : <HexText value={tx.from} classes="smd-pad-2" />}</td>
                  </tr>
                  {tx.to !== undefined && <tr>
                    <td><strong>To</strong></td>
                    <td><HexText value={tx.to} classes="smd-pad-2" /></td>
                  </tr>}
                  {
                    tx.metadata && tx.metadata.funcName &&
                    <tr>
                      <td><strong>Function Name</strong></td>
                      <td>
                        {tx.metadata.funcName}
                      </td>
                    </tr>
                  }
                  {
                    tx.metadata && tx.metadata.name &&
                    <tr>
                      <td><strong>Contract Name</strong></td>
                      <td>
                        {tx.metadata.name}
                      </td>
                    </tr>
                  }
                  {
                    tx.metadata && tx.metadata.args &&
                    <tr>
                      <td><strong>Arguments</strong></td>
                      <td>
                        <pre>
                          {parsedArgs.length > 0 ? parsedArgs.join(',') : 'N/A'}
                        </pre>
                      </td>
                    </tr>
                  }
                  {
                    tx.metadata && tx.metadata.VM &&
                    <tr>
                      <td><strong>VM</strong></td>
                      <td>
                        {tx.metadata.VM}
                      </td>
                    </tr>
                  }
                  <tr>
                    <td><strong>Value</strong></td>
                    <td>{tx.value === undefined ? '' : tx.value}</td>
                  </tr>
                  <tr>
                    <td><strong>Block Number</strong></td>
                    <td>{tx.blockNumber}</td>
                  </tr>
                  <tr>
                    <td><strong>Timestamp</strong></td>
                    <td>{Object.keys(tx).length ? parseDateFromString(tx.timestamp) : ''}</td>
                  </tr>
                  <tr>
                    <td><strong>R</strong></td>
                    <td>{Object.keys(tx).length ? <HexText value={tx.r} classes="smd-pad-2" /> : ''}</td>
                  </tr>
                  <tr>
                    <td><strong>S</strong></td>
                    <td>{Object.keys(tx).length ? <HexText value={tx.s} classes="smd-pad-2" /> : ''}</td>
                  </tr>
                  <tr>
                    <td><strong>V</strong></td>
                    <td>{tx.v}</td>
                  </tr>
                  <tr>
                    <td><strong>Nonce</strong></td>
                    <td>{tx.nonce}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export function mapStateToProps(state, ownProps) {
  const hash = ownProps.match.params.hash;
  return {
    query: state.queryEngine.query,
    selectedChain: state.chains.selectedChain,
    tx: state.transactions.tx.filter((val) => { return val.hash === hash })[0] || state.queryEngine.queryResult.filter((val) => { return val.hash === hash })[0],
    txResult : state.queryEngine.txResult,
    txResultMessage: state.queryEngine.txResultMessage
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    { executeQuery, getTransactionResultRequest }
  )(TransactionView)
);