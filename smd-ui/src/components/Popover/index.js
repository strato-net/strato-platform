import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import './Popover.css'

class Popover extends Component {
    render() {
        return (
            <div className="popover__content">
                <p className="popover__message">{this.props.warnings}</p>
            </div>

        );
    }
}

export default withRouter(connect()(Popover))