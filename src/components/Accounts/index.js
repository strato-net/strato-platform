import React, {Component} from 'react';
import {Button, ProgressBar} from '@blueprintjs/core';
import NumberCard from '../NumberCard';

class Accounts extends Component {

  render() {
    let data = [
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
    let tableRows = data.map(function (val, i) {
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

    return (
      <div>
        <div className="row smd-content-row">
          <div className="col-sm-9 text-left">
            <h2 style={{"margin": "0px"}}>Accounts Tab</h2>
          </div>
          <div className="col-sm-3 text-right">
            {/* //FIXME Align the button to the Accounts Tab h2
             * align it to the right edge as well*/}
            <Button style={{"margin": "1.5px"}} className="pt-intent-primary pt-icon-add">Create User</Button>
          </div>
        </div>
        <div className="row smd-content-row">
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
        <div className="row smd-content-row">
          <div className="col-lg-12">
            <div className="pt-card pt-elevation-2">
              <table className="pt-table pt-interactive smd-full-width">
                <thead>
                <th className="col-sm-3"><h4>Account</h4></th>
                <th className="col-sm-3"><h4>Username</h4></th>
                <th className="col-sm-3"><h4>Balance</h4></th>
                <th className="col-sm-3"><h4>User Activity</h4></th>
                </thead>

                <tbody>
                {tableRows}
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