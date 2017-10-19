import React, { Component } from 'react';
import { connect } from 'react-redux';
import './applications-card.css'
import { withRouter} from 'react-router-dom';

class ApplicationCard extends Component {

  render() {
    const { app } = this.props;

    return (
      <div className="row app-card">
        <div className="col-sm-2 text-right">
          <i className="fa fa-rocket fa-5x" aria-hidden="true"></i>
        </div>
        <div className="col-sm-8">
          <div className="row">
            <div className="col-sm-10">
              <div className="heading">
                <strong> {app.appName} </strong> - <span> v{app.version} </span>
              </div>
            </div>
            <div className="col-sm-2">
              <a href={ app.url } target="_blank" rel="noopener noreferrer">
                <button
                  className="pt-button pt-intent-primary pull-right"
                >
                  Launch
                </button>
              </a>
            </div>
          </div>
          <div className="neutral-baseline"></div>
          <div className="row content">
            <div className="col-sm-12">
              {app.description}
            </div>
          </div>
        </div>
        <div className="col-sm-2"></div>
      </div>
    );
  }

}


function mapStateToProps(state) {
  return {
  };
}

export default withRouter(
  connect( mapStateToProps,
    {
    }
  )(ApplicationCard)
);
