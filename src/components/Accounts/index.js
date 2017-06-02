import React, {Component} from 'react';
import {fetchAccounts} from './accounts.actions'
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import {ProgressBar} from '@blueprintjs/core';
import NumberCard from '../NumberCard';
import CreateUser from '../CreateUser';

class Accounts extends Component {

  componentDidMount() {
    this.props.fetchAccounts();
    this.startPoll();
  }

  componentWillUnmount() {
    clearTimeout(this.timeout)
  }

  startPoll() {
    const fetchAccounts = this.props.fetchAccounts;
    this.timeout = setInterval(function () {
      fetchAccounts();
    }, 5000);
  }

  render() {
    let undef = 0;
    var rows = this.props.accounts.map(function (value, i) {
      if (value !== undefined) {
        return value.address.map((addr, j) => {
          return (<tr key={value.address + i + j}>
            <td className="col-sm-4">{value.name}</td>
            <td className="col-sm-4">{addr}</td>
            <td className="col-sm-4">{value.accountData.balance}</td>
            {/*<td className="col-sm-3"><ProgressBar className="pt-intent-primary"*/}
            {/*value={value.accountData.latestBlockNum / maxBlockNum}/></td>*/}
          </tr>)
        })
      }
      else {
        undef++;
      }
    });

    return (
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-sm-9 text-left">
            <h3>Accounts</h3>
          </div>
          <div className="col-sm-3 text-right">
            <CreateUser/>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-3">
            <NumberCard number={this.props.accounts.length - undef} description="Users"/>
          </div>
          <div className="col-sm-9">
            <div className="pt-card pt-elevation-2">
              <div className="pt-input-group pt-dark pt-large">
                <span className="pt-icon pt-icon-search"></span>
                <input className="pt-input" type="search" placeholder="Search input" dir="auto"/>
              </div>
              <table className="pt-table pt-interactive pt-condensed pt-striped" style={{tableLayout: 'fixed'}}>
                <thead>
                <th className="col-sm-4"><h4>Username</h4></th>
                <th className="col-sm-4"><h4>Account</h4></th>
                <th className="col-sm-4"><h4>Balance</h4></th>
                {/*<th className="col-sm-3"><h4>User Activity</h4></th>*/}
                </thead>

                <tbody>
                {rows}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <br/>
          </div>
        </div>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    accounts: state.accounts.accounts
  };
}

export default withRouter(connect(mapStateToProps, {fetchAccounts})(Accounts));
