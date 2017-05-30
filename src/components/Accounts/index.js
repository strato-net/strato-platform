import React, {Component} from 'react';
import {ProgressBar} from '@blueprintjs/core';
import NumberCard from '../NumberCard';
import CreateUser from '../CreateUser';

class Accounts extends Component {
  dataMock = [
  {
    "account": "47424dbce71e182d2836045b76a7e1ce459d6e08",
    "username": "Alice",
    "balance": "1234",
  }, {
    "account": "6ad318ce7b79c37b262fbda8a603365bbdbd41be",
    "username": "Bob",
    "balance": "2345",
  }, {
    "account": "47424dbce71e182d2836045b76a7e1ce459d6e08",
    "username": "Charlie",
    "balance": "3456",
  }, {
    "account": "6ad318ce7b79c37b262fbda8a603365bbdbd41be",
    "username": "Desiree",
    "balance": "4567",
  }, {
    "account": "6ad318ce7b79c37b262fbda8a603365bbdbd41be",
    "username": "Edward",
    "balance": "5689",
  }];

  //1000000000000000000 wei per ether
  tableRows = this.dataMock.map(function (val, i) {
    return <tr>
      <td className="col-sm-3">
        {val.account}
      </td>
      <td className="col-sm-3">
        {val.username}
      </td>
      <td className="col-sm-3">
        {val.balance} wei
      </td>
      <td className="col-sm-3">
        <ProgressBar className="pt-intent-primary" value={Math.random()}/>
      </td>
    </tr>
  });

  render() {
    return (
      <div>
        <div className="row">
          <div className="col-sm-9 text-left">
            <h2 style={{margin: 0}}>Accounts</h2>
          </div>
          <div className="col-sm-3 text-right">
            {/* //FIXME Align the button to the Accounts Tab h2
             * align it to the right edge as well*/}
            {/*<Button style={{"margin": "1.5px"}} className="pt-intent-primary pt-icon-add">Create User</Button>*/}
            <CreateUser/>
          </div>
        </div>
        <div className="row ">
          <div className="col-sm-3">
            <NumberCard number={1230498} description="Ether"/>
          </div>
          <div className="col-sm-3">
            <NumberCard number={234241} description="TX Volume"/>
          </div>
          <div className="col-sm-3">
            <NumberCard number={245} description="Users"/>
          </div>
          <div className="col-sm-3">
            <NumberCard number={123456} description="Arbitrary User Metric"/>
          </div>
        </div>
        <div className="row ">
          <div className="col-lg-12">
            <div className="pt-card pt-dark pt-elevation-2">
              <table className="pt-table pt-interactive ">
                <thead>
                <th className="col-sm-3"><h4>Account</h4></th>
                <th className="col-sm-3"><h4>Username</h4></th>
                <th className="col-sm-3"><h4>Balance</h4></th>
                <th className="col-sm-3"><h4>User Activity</h4></th>
                </thead>

                <tbody>
                {this.tableRows}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default Accounts
