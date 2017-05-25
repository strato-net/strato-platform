import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import TxList from "../TxList/index";
import { fetchDifficulty } from '../Difficulty/difficulty.actions';
import NumberCard from '../NumberCard';

class Dashboard extends Component {

  componentDidMount() { //FIXME Put fetchDifficulty on a timer?
    this.props.fetchDifficulty();
  }

  render() {
    return (
      <div>
        <div className="row smd-content-row">
          <div className="col-sm-3">
            <NumberCard number={this.props.difficulty} description="Difficulty" />
          </div>
        </div>
        <div className="row smd-content-row">
          <div className="col-lg-12">
            <TxList />
          </div>
        </div>

      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    difficulty: state.difficulty.difficulty,
  };
}

export default withRouter(connect(mapStateToProps, { fetchDifficulty })(Dashboard))
