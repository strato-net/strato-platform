import React, { Component } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { Tooltip, Position } from '@blueprintjs/core';
import './ellipsis-text.css'

class EllipsisText extends Component {
  constructor() {
    super();
    this.state = {
      copied: false
    }
  }
  
  // Add static property for component identification
  static displayName = 'EllipsisText';
  
  render() {
    return (
      <span className="ellipsis-text">
        <CopyToClipboard
          text={this.props.value}
          onCopy={() => { this.setState({ copied: true }); }}>
          <span
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
            }}
          >
            <Tooltip
              content={this.state.copied ? 'Copied!' : 'Copy to clipboard'}
              position={Position.TOP}
              className="smd-pointer" >
              <span
                className="pt-icon pt-icon-clipboard"
                onMouseOut={(e) => { this.setState({ copied: false }); }}>
              </span>
            </Tooltip>
          </span>
        </CopyToClipboard>
        <Tooltip
          content={this.props.value}
          className={`text-tooltip text-left ${this.props.classes || ''}`}
          position={Position.TOP}>
          <span className="text-content">
            {this.props.value}
          </span>
        </Tooltip>
      </span>
    );
  }
}

export default EllipsisText;
