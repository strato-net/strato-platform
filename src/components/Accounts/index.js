import React, {Component} from 'react';
import { fetchAccounts, changeAccountFilter } from './accounts.actions'
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import NumberCard from '../NumberCard';
import CreateUser from '../CreateUser';

class Accounts extends Component {

  componentDidMount() {
    this.props.fetchAccounts();
  }

  componentWillUnmount() {
  }

  updateFilter(filter) {
    this.props.changeAccountFilter(filter);
  };


  render() {
    const accounts = this.props.accounts;
    const filter = this.props.filter;
    const history = this.props.history;
    const users = Object.getOwnPropertyNames(accounts);
    const rows = [];

    function handleClick(user,address) {
      history.push('/accounts/' + user + '/' + address);
    }

    users.forEach(function(user){
      const addresses = Object.getOwnPropertyNames(accounts[user]);

      addresses
        .filter(function(address){
          if(!filter) {
            return true;
          }
          return user.toLowerCase().indexOf(filter) > -1
            || address.toLowerCase().indexOf(filter) > -1;
        })
        .forEach(function(address){
          if(address === 'error') {
            return;
          }
          rows.push(
            <tr key={address} onClick={(e) => handleClick(user,address)}>
              <td className="col-sm-4">{user}</td>
              <td className="col-sm-4">{address}</td>
              <td className="col-sm-4">{accounts[user][address].balance}</td>
            </tr>
          );
        });
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
            <NumberCard number={users.length} description="Users"/>
          </div>
          <div className="col-sm-9">
            <div className="pt-card pt-elevation-2">
              <div className="pt-input-group pt-dark pt-large">
                <span className="pt-icon pt-icon-search"></span>
                <input
                  className="pt-input"
                  type="search"
                  placeholder="Search accounts"
                  onChange={e => this.updateFilter(e.target.value.toLowerCase())}
                  dir="auto"/>
              </div>
              <table className="pt-table pt-interactive pt-condensed pt-striped" style={{tableLayout: 'fixed'}}>
                <thead>
                  <tr>
                    <th className="col-sm-4"><h4>Username</h4></th>
                    <th className="col-sm-4"><h4>Account</h4></th>
                    <th className="col-sm-4"><h4>Balance</h4></th>
                  </tr>
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
    accounts: state.accounts.accounts,
    filter: state.accounts.filter
  };
}

export default withRouter(
  connect(
    mapStateToProps,
    { fetchAccounts, changeAccountFilter }
  )(Accounts)
);
