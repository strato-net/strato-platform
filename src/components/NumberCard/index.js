import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import './NumberCard.css'

import { Textfit } from 'react-textfit';

class NumberCard extends Component {
  render() {
    return (
      <div className="col-sm pt-card pt-dark pt-elevation-2">
        <div className="text-right number">
            <h1>
              <Textfit className="text-fit" mode="single" max={36}>
                {this.props.number}
              </Textfit>
            </h1>

        </div>
        <div className="text-right desc">
          <h5>
            <Textfit className="text-fit" mode="single" max={14}>
              {this.props.description}
            </Textfit>
          </h5>
        </div>
      </div>
    );
  }
}

export default withRouter(connect()(NumberCard))
