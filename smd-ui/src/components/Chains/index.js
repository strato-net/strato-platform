import React, { Component } from 'react';
// import { fetchAccounts, changeAccountFilter, fetchUserAddresses, fetchAccountDetail, resetUserAddress } from './chains.actions';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import Tour from '../Tour';
import CreateChain from '../CreateChain';
import './chains.css';

const tourSteps = [
  {
    title: 'View Chains',
    text: 'Scroll through all chains that you belong to',
    /* text: '<div class="inline-code-sample">contract RentSplit {<br>address <strong>Roommate 1</strong>;<br><strong>Roommate 2</strong>;<br><strong>Roommate 3</strong>;<br>mapping (address => uint) RentSplit;<br></div>', */
    selector: '#contracts',
    position: 'bottom',
    isFixed: true
  }
];

class Chains extends Component {

  constructor() {
    super()
  }

  componentDidMount() {
    mixpanelWrapper.track('chains_page_load')
  }

  render() {
    const chains = this.props.chains;
    const filter = this.props.filter;
    const rows = [];

    return (
      <div className="container-fluid pt-dark">
        <Tour
          name="chains"
          steps={tourSteps}
          finalStepSelector='#contracts'
          nextPage='contracts' />

        <div className="row">
          <div className="col-sm-4 text-left">
            <h3>Chains</h3>
          </div>
          <div className="col-sm-8 text-right">
            <div className="pt-button-group">
              <CreateChain />
            </div>
          </div>
        </div>

        <div className="container-fluid pt-dark">
          <div className="row">
            <div className="col-sm-4 main-div">
              <div className="accounts-margin-top">
                {rows.length === 0
                  ?
                  <table>
                    <tbody>
                      <tr>
                        <td colSpan={3}>No Chains</td>
                      </tr>
                    </tbody>
                  </table>
                  : rows}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default Chains;
