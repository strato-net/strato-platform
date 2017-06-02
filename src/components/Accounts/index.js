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
    //console.log('startPoll', this.props);
    const fetchAccounts = this.props.fetchAccounts;
    this.timeout = setInterval(function () {
      fetchAccounts();
    }, 5000);
  }

  render() {
    const maxBlockNum = Math.max(...this.props.accounts.map(value => {
      return value === undefined ? 1 : value.accountData.latestBlockNum
    }));

    let undef = 0;
    let rows = [];
    this.props.accounts
      .forEach(function (value, i) {
        if (value !== undefined) {
          rows.push(value.address.map(addr => {
            return (
              <tr key={i}>
                <td className="col-sm-3">{value.name}</td>
                <td className="col-sm-3">{addr}</td>
                <td className="col-sm-3">{value.accountData.balance}</td>
                <td className="col-sm-3">
                  <ProgressBar
                    className="pt-intent-primary"
                    value={value.accountData.latestBlockNum / maxBlockNum}
                  />
                </td>
              </tr>)
            })
          );
        }
        else {
          undef++;
        }
      });

    rows = rows.reduce(function (a, b) {
      return a.concat(b);
    }, []);
    const totalEther = "123456";

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
            <NumberCard number={this.props.accounts.length - undef} description="Users"/>
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
                  <tr>
                    <th className="col-sm-3"><h4>Account</h4></th>
                    <th className="col-sm-3"><h4>Username</h4></th>
                    <th className="col-sm-3"><h4>Balance</h4></th>
                    <th className="col-sm-3"><h4>User Activity</h4></th>
                  </tr>
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
