import React, { Component } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { Tooltip, Position, Text } from '@blueprintjs/core';
import './hex-text.css'

class HexText extends Component {
  constructor() {
    super();
    this.state = {
      copied: false
    }
  }
  render() {
    return (
      <span className="hex-text">
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
          <Text ellipsize={this.props.shorten !== undefined ? this.props.shorten : true}>
            {this.props.value}
          </Text>
        </Tooltip>
      </span>
    );
  }
}

export default HexText;
