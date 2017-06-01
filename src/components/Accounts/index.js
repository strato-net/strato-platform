import React, {Component} from 'react';
import {fetchAccounts} from './accounts.actions'
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import {ProgressBar} from '@blueprintjs/core';
import NumberCard from '../NumberCard';
import CreateUser from '../CreateUser';
import BigNumber from 'bignumber.js'

class Accounts extends Component {

  componentDidMount() {
    this.props.fetchAccounts();
    this.startPoll();
  }

  componentWillUnmount() {
    clearTimeout(this.timeout)
  }

  startPoll() {
    //console.log('startPoll', this.props);
    const fetchAccounts = this.props.fetchAccounts;
    this.timeout = setInterval(function () {
      fetchAccounts();
    }, 5000);
  }


  getSum = (total, num) => {
    if (num === undefined) {
      return total;
    }
    return total + new Number(num.balance);
  }

  // dataMock = [
  // {
  //   "account": "47424dbce71e182d2836045b76a7e1ce459d6e08",
  //   "username": "Alice",
  //   "balance": "1234",
  // }, {
  //   "account": "6ad318ce7b79c37b262fbda8a603365bbdbd41be",
  //   "username": "Bob",
  //   "balance": "2345",
  // }, {
  //   "account": "47424dbce71e182d2836045b76a7e1ce459d6e08",
  //   "username": "Charlie",
  //   "balance": "3456",
  // }, {
  //   "account": "6ad318ce7b79c37b262fbda8a603365bbdbd41be",
  //   "username": "Desiree",
  //   "balance": "4567",
  // }, {
  //   "account": "6ad318ce7b79c37b262fbda8a603365bbdbd41be",
  //   "username": "Edward",
  //   "balance": "5689",
  // }];

  render() {
    const maxBlockNum = Math.max(...this.props.accounts.map(value => {
      return value === undefined ? 1 : value.latestBlockNum
    }));

    var undef = 0;

    const rows = this.props.accounts.map(function (value, i) {
      if (value !== undefined) {
        return (<tr key={i}>
          <td className="col-sm-4">{value.address}</td>
          <td className="col-sm-4">{new BigNumber(value.balance).div(1000000000000000000).toString()}</td>
          <td className="col-sm-4"><ProgressBar className="pt-intent-primary"
                                                value={value.latestBlockNum / maxBlockNum}/></td>
        </tr>)
      }
      else {undef++;}
    });

    const totalEther = "123456"

    return (
      <div>
        <div className="row">
          <div className="col-sm-9 text-left">
            <h2 style={{margin: 0}}>Accounts</h2>
          </div>
          <div className="col-sm-3 text-right">
            <CreateUser/>
          </div>
        </div>
        <div className="row ">
          <div className="col-sm-3">
            <NumberCard number={totalEther} description="Ether"/>
          </div>
          <div className="col-sm-3">
            <NumberCard number={234241} description="TX Volume"/>
          </div>
          <div className="col-sm-3">
            <NumberCard number={this.props.accounts.length-undef} description="Users"/>
          </div>
          <div className="col-sm-3">
            <NumberCard number={123456} description="Arbitrary User Metric"/>
          </div>
        </div>
        <div className="row">
          <div className="col-lg-12">
            <div className="pt-card pt-dark pt-elevation-2">
              <table className="pt-table pt-interactive ">
                <thead>
                <th className="col-sm-4"><h4>Account</h4></th>
                {/*<th className="col-sm-3"><h4>Username</h4></th>*/}
                <th className="col-sm-4"><h4>Balance</h4></th>
                <th className="col-sm-4"><h4>User Activity</h4></th>
                </thead>

                <tbody>
                {rows}
                </tbody>
              </table>
            </div>
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
