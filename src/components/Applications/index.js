import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter, Link } from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { Position, Tooltip } from '@blueprintjs/core';

import { fetchApplications } from '../Applications/applications.actions';
import ApplicationCard from '../ApplicationCard';
import { canDeployApps } from '../../lib/envChecks';

import { env } from '../../env';


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
    return (
      <div className="container-fluid pt-dark">
        <div className="row smd-pad-12">
          <div className="col-sm-10">
            <h3>Welcome to Launchpad</h3>
          </div>
          <div className="col-sm-2 text-right smd-pad-vertical-12">
            {this.props.isLoggedIn &&
              <Tooltip
                content={<span>Unable to deploy apps when running multinode on localhost</span>}
                inline={true}
                position={Position.LEFT}
                isDisabled={canDeployApps}
              >
                <Link to="/launchpad">
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
