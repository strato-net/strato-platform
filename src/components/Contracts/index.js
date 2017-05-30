import React, {Component} from 'react';
import CreateContract from '../CreateContract'

class Contracts extends Component {

  render() {
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
                <th className="col-sm-3"><h4>Balance</h4></th>
                <th className="col-sm-3"><h4>Metric</h4></th>
                <th className="col-sm-3"><h4>Contract Activity</h4></th>
                </thead>

                <tbody>
                <tr>
                  <td>No Data</td>
                  <td>No Data</td>
                  <td>No Data</td>
                  <td>No Data</td>
                </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default Contracts