import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter, Link } from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { Position, Tooltip, Button, Dialog } from '@blueprintjs/core';

import { fetchApplications } from '../Applications/applications.actions';
import { openCLIOverlay } from '../CLI/cli.actions';
import { openTokenRequestOverlay } from '../TokenRequest/tokenRequest.actions';
import ApplicationCard from '../ApplicationCard';
import { canDeployApps } from '../../lib/envChecks';
import { env } from '../../env';
import CLI from '../CLI';
import TokenRequest from '../TokenRequest';
import { closeCLIOverlay } from '../CLI/cli.actions';
import qs from 'query-string';

import './application.css'

class Applications extends Component {

  componentDidMount() {
    // I am really sorry for this. But time.
    const developerSignIn = Object.keys(qs.parse(this.props.location.search)).includes('developer');
    if (!this.props.isLoggedIn && !developerSignIn) {
      window.location.href = `${window.location.protocol}//${window.location.hostname}/dappstore/`;
    }

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
    return (
      <div className="container-fluid pt-dark">
        <div className="row smd-pad-12">
          <div className="col-sm-6">
            <h3>Apps</h3>
          </div>
          <div className="col-sm-6 text-right">
            {this.props.isLoggedIn &&
              <Button text="Request Token" onClick={this.props.openTokenRequestOverlay} className="right-align" />}
            {this.props.isLoggedIn &&
              <Button onClick={this.props.openCLIOverlay} text="Add App" className="pt-icon-add right-align" />}

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
                  {this.props.isLoggedIn ? "Deploy an application to get started" : "No Applications found"}
                </div>
              </div>
          }
        </div>
        <Dialog
          isOpen={this.props.isTokenOpen}
          onClose={this.props.closeCLIOverlay}
          title="Download CLI Tool"
          className="pt-dark cli-dialog"
        >
        <CLI addApp />
        </Dialog>
        <TokenRequest />
      </div>
    );
  }

}

export function mapStateToProps(state) {
  return {
    applications: state.applications.applications,
    isLoggedIn: state.user.isLoggedIn,
    isTokenOpen: state.cli.isTokenOpen
  };
}

export default withRouter(
  connect(mapStateToProps,
    {
      fetchApplications,
      openCLIOverlay,
      openTokenRequestOverlay,
      closeCLIOverlay
    }
  )(Applications)
);
