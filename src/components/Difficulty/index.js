import React, { Component } from 'react';
import { connect } from 'react-redux';
import { fetchDifficulty } from './difficulty.actions';
import { withRouter } from 'react-router-dom';
import NumberCard from '../NumberCard';
import './Difficulty.scss'

class Difficulty extends Component {

  componentDidMount() { //FIXME Put fetchDifficulty on a timer? 
    this.props.fetchDifficulty();
  }

  render() {
    return (
      <NumberCard number={this.props.difficulty.difficulty} description="Difficulty"/>
    );
  }
}

function mapStateToProps(state, ownProps) {
  return {
    difficulty: state.difficulty
  };
}

export default withRouter(connect(mapStateToProps, { fetchDifficulty })(Difficulty))
