import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import { Collapse } from '@blueprintjs/core';
import './validators.css';
import ValidatorsCard from '../ValidatorsCard';

class Validators extends Component {

  constructor() {
    super()
    this.state = {
      isOpen: false
    }
  }

  handleClick = () => {
    this.setState({ isOpen: !this.state.isOpen });
  };

  render() {
    const validators = this.props.validators || [];
    let className = 'pt-card pt-elevation-2 node-success pt-interactive';
    let arrowIcon = 'col-xs-3 text-right pt-icon-standard '
    arrowIcon += this.state.isOpen ? 'pt-icon-caret-up' : 'pt-icon-caret-down'

    return (
      <div>
        <div className={className} onClick={this.handleClick}>
          <div className="row pt-text-muted">
            <div className="col-xs-3">
              <small>Number:</small>
            </div>
            <div className="col-xs-9">
              <small>{validators.length}</small>
            </div>
          </div>
        </div>
          <ValidatorsCard />
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    validators: state.appMetadata.metadata ? state.appMetadata.metadata.validators : []
  };
}

export default withRouter(
  connect(
    mapStateToProps,
  )(Validators)
);