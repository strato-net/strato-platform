import React, { Component } from 'react';
import * as Plottable from 'plottable';

class PieChart extends Component {

  constructor(props) {
    super(props);
    this.state = {
      plot: null,
      dataset: null,
      interaction:null,
      tooltipAnchor: null,
      tooltipText: null,
      tooltopBox: null,
    }
  }

  componentDidMount() {
    const self = this;
    const scale = new Plottable.Scales.Linear();
    const colorScale = new Plottable.Scales.InterpolatedColor();
    colorScale.range(["#FF3300", "#3452FF"]);

    // eslint-disable-next-line
    this.state.dataset = new Plottable.Dataset(this.props.data);
    // eslint-disable-next-line
    this.state.plot = new Plottable.Plots.Pie()
      .addDataset(this.state.dataset)
      .sectorValue(function(d) { return d.val; }, scale)
      .attr("fill", function(d) { return d.val; }, colorScale);

    // eslint-disable-next-line
    this.state.interaction = new Plottable.Interactions.Pointer();
    this.state.interaction.onPointerMove(function(p){
      const entities = self.state.plot.entitiesAt(p);
      if(entities.length > 0) {
        const entity = entities[0];
        self.state.tooltipText
          .text(entity.datum.type + ': ' + entity.datum.val);
        const bbox = self.state.tooltipText.node().getBBox();
        self.state.tooltipBox
          .attr('x',bbox.x-8)
          .attr('y',bbox.y-3)
          .attr('width',bbox.width+16)
          .attr('height',bbox.height+6);
        self.state.tooltipAnchor
          .attr('transform','translate(' + entity.position.x + ',' + (entity.position.y+20)  + ')')
          .attr('opacity',1);
      }
    });

    this.state.interaction.onPointerExit(function(){
      self.state.tooltipAnchor
        .attr('opacity',0);
    });

    this.state.interaction.attachTo(this.state.plot);

    this.state.plot.renderTo("div#pc");

    // TODO: this should be refactored into one component. Also see BarGraph
    // eslint-disable-next-line
    this.state.tooltipAnchor = this.state.plot
      .foreground()
      .style('overflow','visible')
      .append('g')
      .attr('opacity', 0);

    // eslint-disable-next-line
    this.state.tooltipBox = this.state.tooltipAnchor
      .append('rect')
      .style('fill','#293742')
      .attr('rx', 4)
      .attr('ry', 4);

    // eslint-disable-next-line
    this.state.tooltipText = this.state.tooltipAnchor
      .append("text")
      .style('fill','#f5f8fa')
      .attr('text-anchor','middle')
      .text('test');

  }

  componentDidUpdate() {
    const scale = new Plottable.Scales.Linear();
    const colorScale = new Plottable.Scales.InterpolatedColor();
    colorScale.range(["#F0C452", "#00AEEF"]);


    this.state.plot
      .sectorValue(function(d) { return d.val; }, scale)
      .attr("fill", function(d) { return d.val; }, colorScale);

    this.state.dataset.data(this.props.data);
  }

  render() {
    return (
      <div className="pt-card pt-dark">
        <div className="row">
          <div className="col-sm-12 text-center">
            <h4>Last 15 Transactions by Type</h4>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-12">
            <div id="pc" style={{height: '189px'}}></div>
          </div>
        </div>
      </div>
    );
  }
}

export default PieChart;
