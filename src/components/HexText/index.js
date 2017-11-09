import React, { Component } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { Icon } from '@blueprintjs/core';
import { Tooltip, Position, Text } from '@blueprintjs/core';

class HexText extends Component {
  constructor() {
    super();
    this.state = {
      copied: false
    }
  }

  render() {
    return (
      <div className="row">
        <Tooltip
          content={this.props.value}
          className={`col-sm-6 text-left smd-pad-right-0 ${this.props.classes || ''}`}
          position={Position.TOP}>
          <Text ellipsize={true}>
            {this.props.value}
          </Text>
        </Tooltip>
        <CopyToClipboard
          text={this.props.value}
          className='col-sm-1 smd-pad-left-0'
          onCopy={() => { this.setState({ copied: true }); }}>
          <div
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault(); }}
          >
            <Tooltip
              content={this.state.copied ? 'Copied!' : 'Copy to clipboard'}
              position={Position.TOP}
              className="smd-pointer" >
              <Icon
                iconName="pt-icon-clipboard"
                iconSize={24}
                onMouseOut={(e) => { this.setState({ copied: false }); }} />
            </Tooltip>
          </div>
        </CopyToClipboard>
      </div>
    );
  }
}

export default HexText;
