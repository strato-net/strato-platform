import React, { Component } from 'react';
import { connect } from 'react-redux';
import { fetchDifficulty } from './difficulty.actions';
import { withRouter } from 'react-router-dom';

class Difficulty extends Component {

  componentDidMount() {
    this.props.getDifficulty();
  }

  render() {
    return (
      <div>
        <h1>{this.props.difficulty}</h1>
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
