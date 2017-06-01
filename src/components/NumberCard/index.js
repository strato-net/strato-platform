import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import './NumberCard.css'

class NumberCard extends Component {
  render() {
    return (
      <div className="col-sm pt-card pt-dark pt-elevation-2">
        <div className="text-right number">
            <h1>
              {this.props.number}
            </h1>

        </div>
        <div className="text-right desc">
          <h5>
            {this.props.description}
          </h5>
        </div>
      </div>
    );
  }
}

export default withRouter(connect()(NumberCard))
