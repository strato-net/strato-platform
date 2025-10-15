import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import './NumberCard.css'

class NumberCard extends Component {
  render() {
    let classes = 'pt-card pt-dark pt-elevation-2 ';
    classes += this.props.mode ? this.props.mode : 'neutral';
    let textSize = this.props.textSize ? this.props.textSize : 'h2';
    
    // Check if the number prop contains a HexText component
    const isHexText = this.props.number && 
      (typeof this.props.number === 'object' && 
       this.props.number.type && 
       this.props.number.type.name === 'HexText');
    
    // Use different alignment for HexText vs regular numbers
    const numberAlignment = isHexText ? 'text-left' : 'text-right';
    const descriptionAlignment = 'text-right'; // Always keep description right-aligned
    
    return (
      <div className={classes}>
        <div className="row">
          <div className="col-xs-4 text-center">
            <i className={'fa ' + this.props.iconClass + ' fa-5x smd-pad-8'} aria-hidden="true"></i>
          </div>
          <div className="col-xs-8">
            <div className={`${textSize} ${numberAlignment}`}>
              <strong>{this.props.number}</strong>
            </div>
            <div className={`h4 ${descriptionAlignment} desc`}>
              {this.props.description}
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default withRouter(connect()(NumberCard))
