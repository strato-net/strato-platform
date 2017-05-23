import React, { Component } from 'react';
import { connect } from 'react-redux';
import { fetchDifficulty } from './difficulty.actions';
import { withRouter } from 'react-router-dom';

class Difficulty extends Component {

  componentDidMount() {
    this.props.fetchDifficulty();
  }

  render() {
    return (
      <div className="App">
        <h1>Difficulty: {this.props.difficulty.difficulty}</h1>
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
