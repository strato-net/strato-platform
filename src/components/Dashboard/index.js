import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import Transactions from "../Transactions";
import { fetchBlockData } from '../BlockData/block-data.actions';
import NumberCard from '../NumberCard';

class Dashboard extends Component {

  componentDidMount() { //FIXME Put fetchDifficulty on a timer?
    this.props.fetchBlockData();
  }

  render() {
    return (
      <div>
        <div className="row smd-content-row">
          <div className="col-sm-9 text-left">
            <h2 style={{margin: 0}}>Dashboard</h2>
          </div>
        </div>
        <div className="row smd-content-row">
          <div className="col-sm-3">
            <NumberCard number={this.props.blockData['difficulty']} description="Difficulty" />
          </div>
          <div className="col-sm-3">
            <NumberCard number={this.props.blockData['number']} description="Current block #" />
          </div>
          <div className="col-sm-3">
            <NumberCard number={this.props.blockData['nonce']} description="Nonce" />
          </div>
          <div className="col-sm-3">
            <NumberCard number={this.props.blockData['gasLimit']} description="Gas Limit" longNumber />
          </div>
        </div>
        <div className="row smd-content-row">
          <div className="col-lg-12">
            <Transactions />
          </div>
        </div>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {
    blockData: state.blockData.blockData,
  };
}

export default withRouter(connect(mapStateToProps, { fetchBlockData })(Dashboard))
