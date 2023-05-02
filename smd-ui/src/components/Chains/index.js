import React, { Component } from 'react';
import {
  fetchChains,
  fetchChainDetail,
  changeChainFilter,
  resetChainId,
  resetInitailLabel
} from './chains.actions';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import Tour from '../Tour';
import CreateChain from '../CreateChain';
import Chain from '../Chain';
import './chains.css';
import HexText from '../HexText';
import { Button, Switch } from '@blueprintjs/core';
import ReactGA from 'react-ga4';

const tourSteps = [
  {
    title: 'View Chains',
    text: 'Scroll through all chains that you belong to',
    selector: '#chains',
    position: 'bottom',
    isFixed: true
  }
];

class Chains extends Component {
  constructor() {
    super()
    this.state = {
      selected: null,
      limit: 25,
      offset: 0,
      useChainIdSearch: false,
      chainId: "",
    }
  }

  componentDidMount() {
    this.props.fetchChains(this.state.limit, this.state.offset);
    mixpanelWrapper.track('chains_page_load');
    ReactGA.send({hitType: "pageview", page: "/shards", title: "Shards"});
  }

  updateLabelFilter(filter) {
    this.props.changeChainFilter(filter);
  };

  searchByChainId() {
    this.props.fetchChains(0, 0, this.state.chainId)
    
  }

  onUserClick(label, chainIds, index) {
    let uniqueKey = `${label}-${index}`
    if (chainIds.length && uniqueKey === this.state.selected) {
      this.props.resetChainId(label);
      this.setState({ selected: null });
    } else {
      mixpanelWrapper.track('chains_row_click');
      chainIds.forEach((chainId) => {
        this.props.fetchChainDetail(label, chainId);
      })
    }
  }

  onNextClick = () => {
    const { offset, limit } = this.state;
    const newOffset = offset + limit;
    this.setState({ offset: newOffset }, () => {
      this.props.fetchChains(this.state.limit, this.state.offset);
    });
  };

  onPrevClick = () => {
    const { offset, limit } = this.state;
    const newOffset = Math.max(0, offset - limit);
    this.setState({ offset: newOffset }, () => {
      this.props.fetchChains(this.state.limit, this.state.offset);
    });
  };

  render() {
    const labelIds = this.props.labelIds;
    const chains = this.props.chains;
    const filter = this.props.filter;
    const labels = Object.getOwnPropertyNames(chains);
    const rows = [];
    let selectedChains = [];

    labels.filter(label => {
      if (!filter) {
        return true;
      }
      return label
        .toLowerCase()
        .indexOf(filter) > -1
    })
      .forEach(function (label, index) {
        const chainIds = Object.getOwnPropertyNames(labelIds[label]);

        let labelClasseName = '';
        let uniqueKey = `${label}-${index}`
        if (this.state.selected === uniqueKey && chainIds.length > 0) {
          labelClasseName = ' selected';
          chainIds.map((chainid, key) =>
            selectedChains.push(<Chain label={label} id={chainid} chain={key} key={key} />)
          );
        }

        rows.push(
          <div className="smd-margin-8" key={label}>
            <div className="row">
              <div className={`pt-card pt-elevation-2 smd-pointer ${labelClasseName}`} key={index} onClick={(e) => {
                this.setState({ selected: uniqueKey });
                this.onUserClick(label, chainIds, index);
              }}>
                <HexText value={label} classes="large smd-pad-4 chain-width" />
              </div>
            </div>
          </div>
        );
      }.bind(this));

    const isPaginationDisplay = rows.length ? true : Boolean(this.state.offset);

    return (
      <div className="container-fluid pt-dark">
        <Tour
          name="chains"
          steps={tourSteps}
          finalStepSelector='#chains'
          nextPage='transactions' />

        <div className="row">
          <div className="col-sm-4 text-left">
            <h3>Shards</h3>
          </div>
          <div className="col-sm-8 text-right">
            <div className="pt-button-group">
              <CreateChain limit={this.state.limit} offset={this.state.offset} />
            </div>
          </div>
        </div>
        <div className="row" style={{display: 'flex', alignItems: 'center'}}>
          <div className="col-sm-4">
            <div className="pt-input-group pt-dark pt-large">
              <span className="pt-icon pt-icon-search"></span>
              <input
                className="pt-input"
                type="search"
                placeholder={`Search Shards (${this.state.useChainIdSearch ? "Shard ID" : "Label"})`}
                onChange={e => {
                  this.state.useChainIdSearch ?
                    this.setState({chainId : e.target.value}) :
                    this.updateLabelFilter(e.target.value.toLowerCase())
                }}
                dir="auto" />
            </div>
          </div >
          <div className="col-sm-2">
            {
              this.state.useChainIdSearch ?
              <button 
                className='pt-button pt-icon-search' 
                onClick={() => this.searchByChainId()}
                >
                  Search
                </button> : undefined
            }
          </div>
          <div className='col-sm-2'>
            <Switch
              checked={this.state.useChainIdSearch}
              onChange={() => {
                this.setState({useChainIdSearch: !this.state.useChainIdSearch}, () => {
                  if (!this.state.useChainIdSearch) {
                    this.props.fetchChains(this.state.limit, this.state.offset)
                    this.setState({chainId : ""})
                  }

                })}}
              label="Search by Shard ID"
              />
          </div>
          
        </div>
        <div className="container-fluid pt-dark">
          <div className="row">
            <div className="col-sm-4 main-div">
              <div className="accounts-margin-top">
                {!rows.length && !this.props.isLoading &&
                  <table>
                    <tbody>
                      <tr>
                        <td colSpan={3}>No Shards</td>
                      </tr>
                    </tbody>
                  </table>}
                  {
                    this.props.isLoading ? <table>
                    <tbody>
                      <tr>
                        <td colSpan={3}>Fetching....</td>
                      </tr>
                    </tbody>
                  </table>
                  : rows
                  }
              </div>
            </div>
            <div className="col-sm-8 account-details">
              <div>
                {selectedChains}
              </div>
            </div>
          </div>
          {isPaginationDisplay &&
            <div className="row">
              <div className="col-sm-1 smd-pad-16 text-left">
                <Button
                  onClick={this.onPrevClick}
                  className="pt-icon-arrow-left"
                  text="Previous"
                  disabled={!(this.state.offset > 0)}
                />
              </div>
              <div className="col-sm-2 text-center" style={{ marginTop: '22px' }}>
                {`Rows ${this.state.offset + 1}-${this.state.offset + Math.min(rows.length, this.state.limit)}`}
              </div>
              <div className="col-sm-1 smd-pad-16 text-right">
                <Button
                  onClick={this.onNextClick}
                  className="pt-icon-arrow-right"
                  text="Next"
                  disabled={rows.length < this.state.limit}
                />
              </div>
            </div>}
        </div>
      </div>
    );
  }
}

export function mapStateToProps(state) {
  return {
    filter: state.chains.filter,
    chains: state.chains.chains,
    labelIds: state.chains.labelIds,
    initialLabel: state.chains.initialLabel,
    isLoading: state.chains.isLoading,
  };
}

export default withRouter(
  connect(mapStateToProps,
    {
      fetchChains,
      fetchChainDetail,
      resetChainId,
      changeChainFilter,
      resetInitailLabel
    }
  )(Chains));