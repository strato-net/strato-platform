import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';

import './NumberCard.scss'

class NumberCard extends Component {
  render() {
    return (
      <div className="container pt-card pt-elevation-3">
        <span className="difficulty"><h1>{this.props.number}</h1></span>
        <span className="desc"><h5>{this.props.description}</h5></span>
      </div>
    );
  }
}

export default withRouter(connect()(NumberCard))
