import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter, Link } from 'react-router-dom';

import { fetchApplications } from '../Applications/applications.actions';
import ApplicationCard from '../ApplicationCard';

import { env } from '../../env';


class Applications extends Component {

  componentDidMount() {
    this.props.fetchApplications();
    this.startPoll();
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
            <Link to="/launchpad">
              <button
                type="button"
                className="pt-button pt-intent-primary"
              >
                Deploy
              </button>
            </Link>
          </div>
        </div>
        <div className="pt-card" style={{'padding-top': '48px' }}>
        {
          this.props.applications && this.props.applications.length > 0 ?
          this.props.applications.map((app, index) => {
            return( <ApplicationCard app={app} key={index} /> );
          }) :
          <div className="row" style={{'padding-bottom': '40px' }}>
            <div className="col-sm-12 text-center">
              Nothing to show Sparky! Deploy an application to get started
            </div>
          </div>
        }
        </div>
      </div>
    );
  }

}

function mapStateToProps(state) {
  return {
    applications: state.applications.applications
  };
}

export default withRouter(
  connect( mapStateToProps,
    {
      fetchApplications
    }
  )(Applications)
);
