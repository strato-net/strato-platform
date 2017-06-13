import React, {Component} from 'react';
import BlockTable from './components/BlockTable';
import mixpanel from 'mixpanel-browser';


class Blocks extends Component {
  componentDidMount() {
    mixpanel.track('blocks_loaded');
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
