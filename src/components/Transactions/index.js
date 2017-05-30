import React, {Component} from 'react';
import {connect} from 'react-redux';
import {fetchTx} from './transactions.actions';
import {withRouter} from 'react-router-dom';
import './Transactions.css'

class Transactions extends Component {

  componentDidMount() { //FIXME Put fetchTx on a timer?
    this.props.fetchTx();
  }

  render() {
    let txRows = this.props.tx.map(
      function (tx, i) {
        const date = new Date(tx.timestamp);
        let hours = date.getHours();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 ? hours : 12;
        const dateStr = hours.toString()
          + ":" + date.getMinutes().toString()
          + " " + ampm
          + " " + date.getMonth().toString()
          + "/" + date.getDate().toString()
          + "/" + date.getFullYear().toString();

        return (
            <tr className="tx-row" key={i}>
              <td className="col-sm">{tx.transactionType}</td>
              <td className="col-sm">{tx.value}</td>
              <td className="col-sm">{tx.from}</td>
              <td className="col-sm">{tx.to === undefined ? "No recipient" : tx.to}</td>
              <td className="col-sm">{dateStr}</td>
            </tr>
        )
      }
    );

    return (
        <div className="row ">
          <div className="col-lg-12">
            <div className="pt-card pt-dark pt-elevation-2">
              <table className="pt-table pt-interactive ">
                <thead>
                <th className="col-sm"><h4>Transaction Type</h4></th>
                <th className="col-sm"><h4>Value</h4></th>
                <th className="col-sm"><h4>Sender</h4></th>
                <th className="col-sm"><h4>Recipient</h4></th>
                <th className="col-sm"><h4>Timestamp</h4></th>
                </thead>

                <tbody>
                {txRows}
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
    tx: state.transactions.tx
  };
}

export default withRouter(connect(mapStateToProps, {fetchTx})(Transactions));
