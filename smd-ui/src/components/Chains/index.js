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
      selected: null
    }
  }

  componentDidMount() {
    this.props.fetchChains();
    mixpanelWrapper.track('chains_page_load')
  }

  updateFilter(filter) {
    this.props.changeChainFilter(filter);
  };

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
            selectedChains.push(<Chain label={label} id={chainid} key={key} />)
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

    return (
      <div className="container-fluid pt-dark">
        <Tour
          name="chains"
          steps={tourSteps}
          finalStepSelector='#chains'
          nextPage='transactions' />

        <div className="row">
          <div className="col-sm-4 text-left">
            <h3>Chains</h3>
          </div>
          <div className="col-sm-8 text-right">
            <div className="pt-button-group">
              <CreateChain />
            </div>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-4">
            <div className="pt-input-group pt-dark pt-large">
              <span className="pt-icon pt-icon-search"></span>
              <input
                className="pt-input"
                type="search"
                placeholder="Search chains"
                onChange={e => this.updateFilter(e.target.value.toLowerCase())}
                dir="auto" />
            </div>
          </div>
        </div>
        <div className="container-fluid pt-dark">
          <div className="row">
            <div className="col-sm-4 main-div">
              <div className="accounts-margin-top">
                {rows.length === 0
                  ?
                  <table>
                    <tbody>
                      <tr>
                        <td colSpan={3}>No Chains</td>
                      </tr>
                    </tbody>
                  </table>
                  : rows}
              </div>
            </div>
            <div className="col-sm-8 account-details">
              <div>
                {selectedChains}
              </div>
            </div>
          </div>
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