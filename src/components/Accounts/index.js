import React, { Component } from 'react';
import { Button, Table, Cell, Column } from '@blueprintjs/core';
import 'normalize.css/normalize.css';
import '@blueprintjs/core/dist/blueprint.css';
import 'bootstrap/dist/css/bootstrap.css'
import './Accounts.css';

class Accounts extends Component {

    render() {
        let data = [
            {
                "account": "0xC1f16c418B66A5aE47A5820e1fdb947A77f29531",
                "username": "Alice",
                "balance": "12",
            },{
                "account": "0xC1f16c418B66A5aE47A5820e1fdb947A77f29531",
                "username": "Bob",
                "balance": "23",
            },{
                "account": "0xC1f16c418B66A5aE47A5820e1fdb947A77f29531",
                "username": "Charlie",
                "balance": "34",
            },{
                "account": "0xC1f16c418B66A5aE47A5820e1fdb947A77f29531",
                "username": "Desiree",
                "balance": "45",
            },{
                "account": "0xC1f16c418B66A5aE47A5820e1fdb947A77f29531",
                "username": "Edward",
                "balance": "56",
            }];

        let tableRows = data.map(function (val, i) {
           return <tr>
               <td className="col-sm-4">
               {val.account}
               </td>
               <td className="col-sm-4">
                   {val.username}
               </td>
               <td className="col-sm-4">
                   {val.balance}
               </td>
           </tr>
        });

        console.log(tableRows);

        return (
            <div className="container account-container pt-card pt-elevation-1">
                <div className="row accounts-row justify-content-left">
                    <div className="col-sm-12 justift-content-sm-left">
                        <h2>Accounts Tab</h2>
                    </div>
                </div>
                <div className="row accounts-row">
                    <div className="col-sm-4">
                        <h4>6 Users</h4>
                    </div>
                </div>
                <div className="row accounts-row">
                    <div className="col-sm-9"></div>
                    <div className="col-sm-3 center-block text-center">
                        <Button className="pt-intent-primary pt-large pt-icon-add">Create User</Button>
                    </div>
                </div>
                <div className="row accounts-row">
                    <div>
                        <table className="pt-table accounts-table">
                            <thead>
                                <tr>
                                    <td className="col-sm-4"><h4>Account</h4></td>
                                    <td className="col-sm-4"><h4>Username</h4></td>
                                    <td className="col-sm-4"><h4>Balance</h4></td>
                                </tr>
                            </thead>

                            <tbody>
                                {tableRows}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    }
}

export default Accounts