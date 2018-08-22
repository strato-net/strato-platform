import React, { Component } from 'react';
import {
  fetchChains,
  fetchChainIds,
  fetchChainDetail,
  changeChainFilter,
  resetChainId
} from './chains.actions';
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
    selector: '#chains',
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

  onUserClick(label, chainids, index) {
    if (chainids.length && index === this.state.selected) {
      this.props.resetChainId(label);
      this.setState({ selected: null });
    } else {
      mixpanelWrapper.track('chains_row_click');
      this.props.fetchChainIds(label, chainids, true);
    }
  }

  render() {
    const labelIds = this.props.labelIds;
    const chains = this.props.chains;
    const filter = this.props.filter;
    const labels = Object.getOwnPropertyNames(chains);
    const rows = [];
    const selectedChains = [];

    labels.filter(label => {
      if (!filter) {
        return true;
      }
      return label
        .toLowerCase()
        .indexOf(filter) > -1
    })
      .forEach(function (label, index) {
        const chainids = Object.getOwnPropertyNames(labelIds[label]);
        let labelClasseName = '';
        if (this.state.selected === index && chainids.length > 0) {
          labelClasseName = ' selected';
          chainids.map(chainid =>
            selectedChains.push(<Chain label={label} id={chainid} key={label} />)
          );
        }

        rows.push(
          <div className="smd-margin-8" key={label}>
            <div className="row">
              <div className={`pt-card pt-elevation-2 smd-pointer ${labelClasseName}`} key={index} onClick={(e) => {
                this.setState({ selected: index });
                this.onUserClick(label, chainids, index);
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
                {selectedChains.length ? selectedChains : null}
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
    labelIds: state.chains.labelIds
  };
}

export default withRouter(
  connect(mapStateToProps,
    {
      fetchChains,
      fetchChainIds,
      fetchChainDetail,
      resetChainId,
      changeChainFilter
    }
  )(Chains));