import React, {Component} from 'react';
import { fetchContracts } from './contracts.actions';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import CreateContract from '../CreateContract';

class Contracts extends Component {

  componentDidMount(){
    this.props.fetchContracts();
  }

  render() {
    var tableRows = this.props.contracts.SimpleStorage === undefined ? (<tr><td>No Data</td><td>No Data</td></tr>) :
      this.props.contracts.SimpleStorage.map(function(val, i) {
          const date = new Date(val.createdAt);
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
        <tr key={i}>
          <td className="col-sm-6">{val.address}</td>
          <td className="col-sm-6">{dateStr}</td>
        </tr>
      )
    })
    return (
      <div>
        <div className="row smd-content-row">

          <div className="col-sm-9 text-left">
            <h2 style={{margin: 0}}>Contracts</h2>
          </div>

          <div className="col-sm-3 text-right">
            {/* //FIXME Align the button to the Accounts Tab h2
             * align it to the right edge as well*/}
            {/*<Button style={{"margin": "1.5px"}} className="pt-intent-primary pt-icon-add">Create User</Button>*/}
            <CreateContract/>
          </div>

        </div>
        <div className="row smd-content-row">

          <div className="col-sm-6">
            <div className="pt-input-group pt-large">
              <span className="pt-icon pt-icon-search"></span>
              <input className="pt-input" type="search" placeholder="Search input" dir="auto" />
            </div>
          </div>

        </div>

        <div className="row smd-content-row">
          <div className="col-lg-12">
            <div className="pt-card pt-elevation-2">
              <table className="pt-table pt-interactive smd-full-width">
                <thead>
                <th className="col-sm-3"><h4>Contract Address</h4></th>
                <th className="col-sm-3"><h4>Created At</h4></th>
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

function mapStateToProps(state) {
  return {
    contracts: state.contracts.contracts
  };
}

export default withRouter(connect(mapStateToProps, {fetchContracts})(Contracts));