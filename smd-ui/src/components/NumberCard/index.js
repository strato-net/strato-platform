import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import './NumberCard.css'

class NumberCard extends Component {
  render() {
    let classes = 'pt-card pt-dark pt-elevation-2 ';
    classes += this.props.mode ? this.props.mode : 'neutral';
    let textSize = this.props.textSize ? this.props.textSize : 'h2'
    return (
      <div className={classes}>
        <div className="row">
          <div className="col-xs-4 text-center">
            <i className={'fa ' + this.props.iconClass + ' fa-5x smd-pad-8'} aria-hidden="true"></i>
          </div>
          <div className="col-xs-8">
            <div className={`${textSize} text-right`}>
              <strong>{this.props.number}</strong>
            </div>
            <div className="h4 text-right desc">
              {this.props.description}
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default withRouter(connect()(NumberCard))
