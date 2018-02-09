import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter, Link } from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { Position, Tooltip, Button } from '@blueprintjs/core';

import { fetchApplications } from '../Applications/applications.actions';
import ApplicationCard from '../ApplicationCard';
import { canDeployApps } from '../../lib/envChecks';
import cli from '../../cli.pdf'
import { env } from '../../env';
import { downloadPDFFile } from '../../lib/fileHandler'
import './application.css'

class Applications extends Component {

  componentDidMount() {
    mixpanelWrapper.track('launchpad_load');
    this.props.fetchApplications();
    this.startPoll();
  }

  componentWillUnmount() {
    clearTimeout(this.timeout)
  }

  startPoll() {
    const fetchApplications = this.props.fetchApplications;
    this.timeout = setInterval(function () {
      fetchApplications();
    }, env.POLLING_FREQUENCY);
  }

  render() {
    // TODO with user address(JWT)
    let mailto = `mailto:product@blockapps.net?subject=Faucet Request&body=Requesting faucet funds into <USER ADDRESS> on the STRATO public network`;
    // -----------------------------

    return (
      <div className="container-fluid pt-dark">
        <div className="row smd-pad-12">
          <div className="col-sm-6">
            <h3>Welcome to Launchpad</h3>
          </div>
          <div className="col-sm-6 text-right">
            {this.props.isLoggedIn && <a className="mailto" href={mailto}>
              <Button text="Faucet" onClick={mixpanelWrapper.track('Faucet_click')} className="right-align" />
            </a>}
            {this.props.isLoggedIn && <Button onClick={() => {
              mixpanelWrapper.track('Add_App_click');
              downloadPDFFile('cli.pdf', cli)
            }} text="Add App" className="pt-icon-add right-align" />}

            {this.props.isLoggedIn &&
              <Tooltip
                content={<span>Unable to deploy apps when running multinode on localhost</span>}
                inline={true}
                position={Position.LEFT}
                isDisabled={canDeployApps}
              >
                <Link className="right-align" to="/launchpad">
                  <button
                    type="button"
                    className="pt-button pt-intent-primary"
                    disabled={!canDeployApps}
                  >
                    Deploy
                </button>
                </Link>
              </Tooltip>}
          </div>
        </div>
        <div>
          {
            this.props.applications && this.props.applications.length > 0 ?
              this.props.applications.map((app, index) => {
                return (<ApplicationCard app={app} key={index} />);
              }) :
              <div className="row" style={{ 'paddingBottom': '40px' }}>
                <div className="col-sm-12 text-center">
                  Deploy an application to get started
            </div>
              </div>
          }
        </div>
      </div>
    );
  }

}

export function mapStateToProps(state) {
  return {
    applications: state.applications.applications,
    isLoggedIn: state.user.isLoggedIn
  };
}

export default withRouter(
  connect(mapStateToProps,
    {
      fetchApplications
    }
  )(Applications)
);
