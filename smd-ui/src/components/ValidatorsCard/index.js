import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Text } from '@blueprintjs/core';
import './validatorsCard.css';

class ValidatorsCard extends Component {

  render() {
    const validators = this.props.validators || [];
    let className = 'pt-card pt-elevation-2';
    return (
      <div className={className}>
        <h4>Validators ({validators.length})</h4>
        {validators.length > 0
          ? validators.map((validator, index) => {
            return (
              <div key={index} className="row node-peers smd-vertical-center">
                <div className="col-xs-2">
                  <i className={'fa fa-gavel fa-2x'} aria-hidden="true"></i>
                </div>
                <div className='col-xs-10'>
                  <div className='row'>
                    <div className="col-xs-6">
                      <small>
                        Common Name:
                      </small>
                    </div>
                    <div className="col-xs-6">
                      <Text ellipsize={true}>
                        <small>
                          {validator.commonName}
                        </small>
                      </Text>
                    </div>
                  </div>
                  <div className='row'>
                    <div className="col-xs-6">
                      <small>
                        Organization:
                      </small>
                    </div>
                    <div className="col-xs-6">
                      <Text ellipsize={true}>
                        <small>
                          {validator.orgName}
                        </small>
                      </Text>
                    </div>
                  </div>
                  <div className='row'>
                    <div className="col-xs-6">
                      <small>
                        Org. Unit:
                      </small>
                    </div>
                    <div className="col-xs-6">
                      <Text ellipsize={true}>
                        <small>
                          {validator.orgUnit}
                        </small>
                      </Text>
                    </div>        
                  </div>
                </div>
              </div>
            )
          })
          : <Text ellipsize={true}>
            <small>No Validators</small>
          </Text>}
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return { 
    validators: state.appMetadata.metadata ? state.appMetadata.metadata.validators : []
  };
}

export default withRouter(connect(mapStateToProps, null)(ValidatorsCard));
