import React, {Component} from 'react';
import BlockTable from './components/BlockTable';
import mixpanelWrapper from '../../lib/mixpanelWrapper';

class Blocks extends Component {
  componentDidMount() {
    mixpanelWrapper.track('blocks_loaded');
  }

  render() {
    return(
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-sm-3">
            <h3>Blocks</h3>
          </div>
        </div>
        <BlockTable/>
      </div>
    );
  }
}

export default Blocks;
