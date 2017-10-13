import React, { Component } from 'react';
import { Button } from '@blueprintjs/core';
import './applications-card.css'

class ApplicationCard extends Component {

  render() {
    const { app } = this.props;
    
    return (
      <div className="row app-card">
        <div className="col-sm-2 text-right">
          <img src={require('../../mock_apps/dump.png')} alt={app.title} height="80" width="80"/>
        </div>
        <div className="col-sm-8">
          <div className="row">
            <div className="col-sm-10">
              <div className="heading"> 
                <span style={{fontWeight: 'bold'}}> {app.title} </span> - <span> {app.description} </span>
              </div>
            </div>
            <div className="col-sm-2">
              <Button 
                className="pt-intent-primary pull-right"
                text="Launch" />
            </div>
          </div>
          <div className="neutral-baseline"></div>
          <div className="row content">
            <div className="col-sm-12">
              {app.content}
            </div>
          </div>
        </div>
        <div className="col-sm-2"></div>
      </div>
    );
  }

}

export default ApplicationCard;