import React, { Component } from 'react';
import { connect } from 'react-redux';
import { Button, Popover, Tooltip, PopoverInteractionKind, Position, Tooltip} from '@blueprintjs/core';
import ReactGA from 'react-ga4';
import { Field, reduxForm } from 'redux-form';
import { selectChain, fetchChainIds } from '../Chains/chains.actions';
import { withRouter } from 'react-router-dom';

class ChainSelector extends Component {
    constructor(props) {
        super(props);
        this.state = {
          limit: 10,
          offset: 0,
        }
    }

    onNextChainClick = () => {
        const { offset, limit } = this.state;
        const newOffset = offset + limit;
        this.setState({ offset: newOffset }, () => {
          this.props.fetchChainIds(this.state.limit, this.state.offset);
        });
    };
    
    onPrevChainClick = () => {
        const { offset, limit } = this.state;
        const newOffset = Math.max(0, offset - limit);
        this.setState({ offset: newOffset }, () => {
            this.props.fetchChainIds(this.state.limit, this.state.offset);
        });
    };
    render() {
        <Tooltip content={this.props.selectedChain || 'Main Chain'} position={Position.BOTTOM} interactionKind={PopoverInteractionKind.HOVER}>

              <div className='row' style={{ display: 'flex', alignItems: 'center'}}>
                <h5 className='col-sm-3' style={{margin: '0 auto'}}>Chain Selection:</h5>
                <div className="pt-select" style={{margin: '0 5px'}}>
                  <Field
                    className="pt-input select-chain"
                    component="select"
                    name="chainLabel"
                    onChange={
                      (e) => {
                        const data = e.target.value === 'Main Chain' ? null : e.target.value;
                        this.props.selectChain(data);
                      }
                    }
                    required
                    >
                    <option>Main Chain </option>
                    {
                      sampleChainIds.map((label, i) => {
                        return (
                          <option key={label.id} value={label.id}>{label.label}</option>
                          )
                        })
                      }
                  </Field>
                </div>
              <div className="col-sm-2 text-left">
                <Button
                  onClick={this.onPrevChainClick}
                  className="pt-icon-arrow-left"
                  text="Previous"
                  disabled={!(this.state.offset > 0)}
                  />
              </div>
              <div className="col-sm-2 text-right">
                <Button
                  onClick={this.onNextChainClick}
                  className="pt-icon-arrow-right"
                  text="Next"
                  disabled={sampleChainIds.length < this.state.limit}
                  />
              </div>
                  
            </div>
        </Tooltip>
    }
}
export function mapStateToProps(state) {
    return {
      selectedChain: state.chains.selectedChain,
      chainIds: state.chains.chainIds,
    };
}

const formed = reduxForm({ form: 'ChainSelector' })(ChainSelector);
const connected = connect(mapStateToProps, {
  selectChain,
  fetchChainIds
})(formed);

export default withRouter(connected);