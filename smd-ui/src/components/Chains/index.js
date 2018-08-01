import React, { Component } from 'react';
import { fetchChains, fetchChainId, fetchChainDetail, changeChainFilter, resetChainId } from './chains.actions';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import Tour from '../Tour';
import CreateChain from '../CreateChain';
import Chain from '../Chain';
import './chains.css';

const tourSteps = [
  {
    title: 'View Chains',
    text: 'Scroll through all chains that you belong to',
    selector: '#contracts',
    position: 'bottom',
    isFixed: true
  }
];

class Chains extends Component {
constructor() {
    super()
    this.state = {
      selected: 0
    }
  }

  componentDidMount() {
    this.props.fetchChains(true, true);
    mixpanelWrapper.track('chains_page_load')
  }

  updateFilter(filter) {
    this.props.changeChainFilter(filter);
  };

  onUserClick(label, chainid, chainlabels, chainids, index) {
    if (chainid.length && index === this.state.selected) {
      this.props.resetChainId(label);
      this.setState({ selected: null });
    } else {
      this.props.fetchChainId(label, chainlabels, chainids, true);
      mixpanelWrapper.track('chains_row_click');
    }
  }

  render() {
    console.log("RENDER~~~~~");
    const chainLabels = this.props.chainLabels;
    const chainIds = this.props.chainIds;
    const chains = this.props.chains;
    const filter = this.props.filter;
    const labels = Object.getOwnPropertyNames(chainLabels);
    const ids = Object.getOwnPropertyNames(chainIds);
    const rows = [];
    const selectedChain = [];

    labels.filter(label => {
      if (!filter) {
        return true;
      }
      return label
        .toLowerCase()
        .indexOf(filter) > -1
    })
      .forEach(function (label, index) {
        const chainid = Object.getOwnPropertyNames(chains[label]);
        // const pos = labels.indexOf(label);
        // const chainids = ids[pos];
        let labelClasseName = '';
        if (this.state.selected === index && chainid.length > 0) {
          labelClasseName = ' selected';
          selectedChain.push(<Chain label={label} id={chainid} />)
        }

        rows.push(
          <div className="smd-margin-8" key={label}>
            <div className="row">
              <div className={`pt-card pt-elevation-2 smd-pointer ${labelClasseName}`} key={index} onClick={(e) => {
                this.setState({ selected: index });
                this.onUserClick(label, chainid, labels, ids, index);
              }}>
                {label}
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
          finalStepSelector='#contracts'
          nextPage='contracts' />

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
                {selectedChain.length ? selectedChain : null}
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
    chainLabels: state.chains.chainLabels,
    chainIds: state.chains.chainIds,
    chains: state.chains.chains
  };
}

export default withRouter(
  connect(mapStateToProps,
    {
      fetchChains,
      fetchChainId,
      fetchChainDetail,
      resetChainId,
      changeChainFilter
    }
  )(Chains));