import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter, Link } from 'react-router-dom';

import { fetchApplications } from '../Applications/applications.actions';
import ApplicationCard from '../ApplicationCard';

class Applications extends Component {

  componentDidMount() {
    this.props.fetchApplications();
  }

  render() {
    return (
      <div className="container-fluid pt-dark">
        <div className="row smd-pad-12">
          <div className="col-sm-10">
            <h3>Welcome to Launchpad</h3>
          </div>
          <div className="col-sm- text-right smd-pad-vertical-12">
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
        <div className="pt-dark">
        {
          this.props.applications && this.props.applications.map((app, index) => {
            return( <ApplicationCard app={app} key={index} /> );
          })
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
