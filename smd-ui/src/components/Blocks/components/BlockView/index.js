import React, { Component } from 'react';
import mixpanelWrapper from '../../../../lib/mixpanelWrapper';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button, Text, Position, Tooltip } from '@blueprintjs/core';
import { fetchBlockData } from '../../../BlockData/block-data.actions';
import HexText from '../../../HexText';
import moment from 'moment';

class BlockView extends Component {

  componentDidMount() {
    this.props.fetchBlockData();
  }

  handleClick(hash) {
    mixpanelWrapper.track('transactions_row_click');
    const history = this.props.history;
    history.push('/transactions/' + hash);
  }

  render() {
    const self = this
    const blockNumber = this.props.match.params.block;
    const block = this.props.block;
    const recipientTransactions = block && block.receiptTransactions
    let txRows = recipientTransactions && recipientTransactions.map(
      function (tx, i) {
        return (
          <tr key={i} onClick={() => {
            self.handleClick(tx.hash)
          }}>
            <td width="60%">
              <HexText value={tx.hash} classes="small smd-pad-4" />
            </td>
            <td width="20%">
              <Text ellipsize={true}>
                <Tooltip tooltipClassName="smd-padding-8" content={tx.value + ' wei'} position={Position.TOP_LEFT}>
                  <small>{tx.value} wei</small>
                </Tooltip>
              </Text>
            </td>
            <td width="20%">
              <small>{tx.transactionType}</small>
            </td>
          </tr>
        )
      }
    );
    const validators = block && block.blockData && block.blockData.currentValidators
    let valRows = validators && validators.map(
      function (v, i) {
        return (
          <tr key={i}>
            <td width="60%">
              <Text classes="small smd-pad-4">
                {v.commonName}
              </Text>
            </td>
          </tr>
        )
      }
    );
    const newValidators = block && block.blockData && block.blockData.newValidators
    let newValRows = newValidators && newValidators.map(
      function (v, i) {
        return (
          <tr key={i}>
            <td width="60%">
              <Text classes="small smd-pad-4">
                {v.commonName}
              </Text>
            </td>
          </tr>
        )
      }
    );
    const removedValidators = block && block.blockData && block.blockData.removedValidators
    let removedValRows = removedValidators && removedValidators.map(
      function (v, i) {
        return (
          <tr key={i}>
            <td width="60%">
              <Text classes="small smd-pad-4">
                {v.commonName}
              </Text>
            </td>
          </tr>
        )
      }
    );
    const newCerts = block && block.blockData && block.blockData.newCerts
    let newCertRows = newCerts && newCerts.map(
      function (v, i) {
        return (
          <tr key={i}>
            <td width="60%">
              <Text ellipsize={true} classes="small smd-pad-4">
                {v}
              </Text>
            </td>
          </tr>
        )
      }
    );
    const revokedCerts = block && block.blockData && block.blockData.revokedCerts
    let revokedCertRows = revokedCerts && revokedCerts.map(
      function (v, i) {
        return (
          <tr key={i}>
            <td width="60%">
              <Text ellipsize={true} classes="small smd-pad-4">
                {v}
              </Text>
            </td>
          </tr>
        )
      }
    );
    const proposal = block && block.blockData && block.blockData.proposalSignature
    let proposalRows = proposal && (
          <tr key={0}>
            <td width="40%">
              <HexText ellipsize={true} value={proposal.r} classes="small smd-pad-4" />
            </td>
            <td width="40%">
              <HexText ellipsize={true} value={proposal.s} classes="small smd-pad-4" />
            </td>
            <td width="20%">
              <HexText ellipsize={true} value={proposal.v} classes="small smd-pad-4" />
            </td>
          </tr>
        );
    const signatures = block && block.blockData && block.blockData.signatures
    let signatureRows = signatures && signatures.map(
      function (v, i) {
        return (
          <tr key={i}>
            <td width="40%">
              <HexText ellipsize={true} value={v.r} classes="small smd-pad-4" />
            </td>
            <td width="40%">
              <HexText ellipsize={true} value={v.s} classes="small smd-pad-4" />
            </td>
            <td width="20%">
              <HexText ellipsize={true} value={v.v} classes="small smd-pad-4" />
            </td>
          </tr>
        )
      }
    );

    return (
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-sm-9">
            <div className="h3">Block #{blockNumber}</div>
          </div>
          <div className="col-sm-3 smd-pad-16 text-right">
            <Button
              onClick={(e) => { mixpanelWrapper.track('block_view_go_back_click'); this.props.history.goBack() }}
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
                        <HexText value={block.blockData.parentHash} classes="small smd-pad-4" />
                      </td>
                    </tr>
                    {block.blockData.difficulty && (
                    <tr>
                      <td>Difficulty</td>
                      <td>
                        <small>
                          <Text ellipsize={true}>
                            {block.blockData.difficulty}
                          </Text>
                        </small>
                      </td>
                    </tr>)}
                    {block.blockData.nonce && (
                    <tr>
                      <td>Nonce</td>
                      <td>
                        <small>
                          <Text ellipsize={true}>
                            {block.blockData.nonce}
                          </Text>
                        </small>
                      </td>
                    </tr>)}
                    <tr>
                      <td>State Root</td>
                      <td>
                        <HexText value={block.blockData.stateRoot} classes="small smd-pad-4" />
                      </td>
                    </tr>
                    <tr>
                      <td>Transactions Root</td>
                      <td>
                        <HexText value={block.blockData.transactionsRoot} classes="small smd-pad-4" />
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

        <div className="row">
          <div className="col-sm-12">
            <div className="h3">Transactions </div>
            <table className="pt-table pt-interactive pt-condensed pt-striped"
              style={{ tableLayout: 'fixed', width: "100%" }}>
              <thead>
                <tr>
                  <th width="60%"><h5>Hash</h5></th>
                  <th width="20%" className="text-right"><h5>Value</h5></th>
                  <th width="20%"><h5>Type</h5></th>
                </tr>
              </thead>

              <tbody>
                {txRows && txRows.length === 0 ? <tr>
                  <td colSpan={5}>No Data</td>
                </tr> : txRows}
              </tbody>
            </table>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <div className="h3">Validators </div>
            <table className="pt-table pt-interactive pt-condensed pt-striped"
              style={{ tableLayout: 'fixed', width: "100%" }}>
              <thead>
                <tr>
                  <th width="60%"><h5>Username</h5></th>
                </tr>
              </thead>

              <tbody>
                {valRows && valRows.length === 0 ? <tr>
                  <td colSpan={5}>No Data</td>
                </tr> : valRows}
              </tbody>
            </table>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <div className="h3">New Validators </div>
            <table className="pt-table pt-interactive pt-condensed pt-striped"
              style={{ tableLayout: 'fixed', width: "100%" }}>
              <thead>
                <tr>
                  <th width="60%"><h5>Username</h5></th>
                </tr>
              </thead>

              <tbody>
                {newValRows && newValRows.length === 0 ? <tr>
                  <td colSpan={5}>No Data</td>
                </tr> : newValRows}
              </tbody>
            </table>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <div className="h3">Removed Validators </div>
            <table className="pt-table pt-interactive pt-condensed pt-striped"
              style={{ tableLayout: 'fixed', width: "100%" }}>
              <thead>
                <tr>
                  <th width="60%"><h5>Username</h5></th>
                </tr>
              </thead>

              <tbody>
                {removedValRows && removedValRows.length === 0 ? <tr>
                  <td colSpan={5}>No Data</td>
                </tr> : removedValRows}
              </tbody>
            </table>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <div className="h3">New Certificates </div>
            <table className="pt-table pt-interactive pt-condensed pt-striped"
              style={{ tableLayout: 'fixed', width: "100%" }}>
              <thead>
                <tr>
                  <th width="60%"><h5>Certificate Data</h5></th>
                </tr>
              </thead>

              <tbody>
                {newCertRows && newCertRows.length === 0 ? <tr>
                  <td colSpan={5}>No Data</td>
                </tr> : newCertRows}
              </tbody>
            </table>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <div className="h3">Revoked Certificates </div>
            <table className="pt-table pt-interactive pt-condensed pt-striped"
              style={{ tableLayout: 'fixed', width: "100%" }}>
              <thead>
                <tr>
                  <th width="60%"><h5>Address</h5></th>
                </tr>
              </thead>

              <tbody>
                {revokedCertRows && revokedCertRows.length === 0 ? <tr>
                  <td colSpan={5}>No Data</td>
                </tr> : revokedCertRows}
              </tbody>
            </table>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <div className="h3">Proposal Signature </div>
            <table className="pt-table pt-interactive pt-condensed pt-striped"
              style={{ tableLayout: 'fixed', width: "100%" }}>
              <thead>
                <tr>
                  <th width="40%"><h5>R</h5></th>
                  <th width="40%"><h5>S</h5></th>
                  <th width="20%"><h5>V</h5></th>
                </tr>
              </thead>

              <tbody>
                {proposalRows && proposalRows.length === 0 ? <tr>
                  <td colSpan={5}>No Data</td>
                </tr> : proposalRows}
              </tbody>
            </table>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <div className="h3">Commitment Signatures </div>
            <table className="pt-table pt-interactive pt-condensed pt-striped"
              style={{ tableLayout: 'fixed', width: "100%" }}>
              <thead>
                <tr>
                  <th width="40%"><h5>R</h5></th>
                  <th width="40%"><h5>S</h5></th>
                  <th width="20%"><h5>V</h5></th>
                </tr>
              </thead>

              <tbody>
                {signatureRows && signatureRows.length === 0 ? <tr>
                  <td colSpan={5}>No Data</td>
                </tr> : signatureRows}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    );
  }
}

export function mapStateToProps(state, ownProps) {
  const blockNumber = Number(ownProps.match.params.block);
  return {
    block: state.blockData.blockData.filter((val) => {
      return val.blockData.number === blockNumber
    })[0] || state.queryEngine.queryResult.filter((val) => { return val.blockData.number === blockNumber })[0]
  };
}

export default withRouter(
  connect(
    mapStateToProps, {
      fetchBlockData
    }
  )(BlockView)
);
