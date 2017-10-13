import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Button } from '@blueprintjs/core';

import { fetchApplications } from '../Applications/applications.actions';
import ApplicationCard from '../ApplicationCard';

class Applications extends Component {

  componentDidMount() {
    this.props.fetchApplications();
  }

  render() {
    return (
    <div className="container-fluid pt-dark">
      <div className="row smd-pad-12" style={{marginBottom: '30px'}}>
        <div className="col-sm-10">
          <h3>Welcome to Launchpad</h3>
        </div>
        <div className="col-sm-2">
          <Button 
            className="pt-intent-primary"
            style={{marginTop: '20px'}}
            text="Deploy"
          />
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
