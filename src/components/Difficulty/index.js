import React, { Component } from 'react';
import { connect } from 'react-redux';
import { fetchDifficulty } from './difficulty.actions';
import { withRouter } from 'react-router-dom';

import './Difficulty.scss'

class Difficulty extends Component {

  componentDidMount() {
    this.props.fetchDifficulty();
  }

  render() {
    return (
      <div className="container pt-card pt-elevation-3">
        <span className="difficulty"><h1>{this.props.difficulty.difficulty}</h1></span>
        <span className="desc"><h5>Difficulty</h5></span>
      </div>
    );
  }
}

function mapStateToProps(state, ownProps) {
  return {
    difficulty: state.difficulty
  };
}

export default withRouter(connect(mapStateToProps, { fetchDifficulty })(Difficulty))
