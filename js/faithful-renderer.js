/*
 * faithful-renderer.js — drives the legacy pixel-faithful renderer
 * (js/legacy/worker.js, from the original PPTX2HTML project) and returns
 * per-slide static HTML with PowerPoint's absolute layout preserved.
 *
 *   FaithfulRenderer.render(arrayBuffer, { onProgress }) → Promise<{
 *     slides: [htmlString],     // one .pslide div per slide, charts baked in
 *     slideSize: { width, height },   // px at 96dpi
 *     globalCss: string,        // worker-generated text styles, .pslide-scoped
 *     hasCharts: bool
 *   }>
 *
 * Charts: the worker emits placeholder divs and queues chart data; we render
 * them with nvd3 into an off-screen stage, wait for the draw transition, then
 * serialize — the exported markup contains plain static <svg>, so the deck
 * needs no chart library at runtime.
 */
(function (global) {
  'use strict';

  var CHART_SETTLE_MS = 900; // nvd3 draw transition is 500ms

  function renderChart(d) {
    var chartData = d.chartData;
    var data = [];
    var chart = null;
    switch (d.chartType) {
      case 'lineChart':
        data = chartData;
        chart = nv.models.lineChart().useInteractiveGuideline(true);
        chart.xAxis.tickFormat(function (v) { return chartData[0].xlabels[v] || v; });
        break;
      case 'barChart':
        data = chartData;
        chart = nv.models.multiBarChart();
        chart.xAxis.tickFormat(function (v) { return chartData[0].xlabels[v] || v; });
        break;
      case 'pieChart':
      case 'pie3DChart':
        data = chartData[0].values;
        chart = nv.models.pieChart();
        break;
      case 'areaChart':
        data = chartData;
        chart = nv.models.stackedAreaChart().clipEdge(true).useInteractiveGuideline(true);
        chart.xAxis.tickFormat(function (v) { return chartData[0].xlabels[v] || v; });
        break;
      case 'scatterChart':
        for (var i = 0; i < chartData.length; i++) {
          var arr = [];
          for (var j = 0; j < chartData[i].length; j++) arr.push({ x: j, y: chartData[i][j] });
          data.push({ key: 'data' + (i + 1), values: arr });
        }
        chart = nv.models.scatterChart().showDistX(true).showDistY(true)
          .color(d3.scale.category10().range());
        chart.xAxis.axisLabel('X').tickFormat(d3.format('.02f'));
        chart.yAxis.axisLabel('Y').tickFormat(d3.format('.02f'));
        break;
      default:
        return false;
    }
    d3.select('#' + d.chartID).append('svg').datum(data)
      .transition().duration(500).call(chart);
    return true;
  }

  // Parse the worker's HTML output into live nodes (DOMParser keeps any
  // script element inert; the markup comes from our own renderer anyway).
  function parseNodes(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var frag = document.createDocumentFragment();
    // adoptNode MOVES the node out of the parsed document (importNode would
    // clone it, leaving doc.body.firstChild in place forever)
    while (doc.body.firstChild) frag.appendChild(document.adoptNode(doc.body.firstChild));
    return frag;
  }

  function render(arrayBuffer, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress || function () {};

    return new Promise(function (resolve, reject) {
      var worker;
      try {
        worker = new Worker('js/legacy/worker.js?v=4');
      } catch (e) {
        reject(new Error('Could not start the layout renderer: ' + e.message));
        return;
      }

      var slideHtmls = [];
      var slideSize = null;
      var globalCss = '';
      var settled = false;

      function fail(msg) {
        if (settled) return;
        settled = true;
        worker.terminate();
        reject(new Error(msg));
      }

      // The worker stops reporting if a slide XML is malformed; cap the wait.
      var watchdog = setTimeout(function () { fail('The layout renderer timed out.'); }, 120000);

      worker.addEventListener('message', function (e) {
        var msg = e.data;
        switch (msg.type) {
          case 'slide':
            slideHtmls.push(msg.data);
            break;
          case 'slideSize':
            slideSize = msg.data;
            break;
          case 'globalCSS':
            // worker emits element-scoped rules ("section .cls{…}")
            globalCss = String(msg.data).replace(/(^|\n)section /g, '$1.pslide ');
            break;
          case 'progress-update':
            onProgress(msg.data, 100, 'Rendering original layout… ' + Math.round(msg.data) + '%');
            break;
          case 'ExecutionTime':
            worker.postMessage({ type: 'getMsgQueue' });
            break;
          case 'processMsgQueue':
            clearTimeout(watchdog);
            finish(msg.data || []);
            break;
          case 'ERROR':
            clearTimeout(watchdog);
            fail('Layout renderer: ' + msg.data);
            break;
          default:
            break; // INFO / DEBUG / WARN / pptx-thumb — not needed
        }
      });

      worker.addEventListener('error', function (e) {
        clearTimeout(watchdog);
        fail('Layout renderer crashed: ' + (e.message || 'unknown error'));
      });

      function finish(chartQueue) {
        if (settled) return;

        var stage = document.createElement('div');
        stage.id = 'faithful-stage';
        stage.style.cssText = 'position:fixed;left:-12000px;top:0;overflow:hidden;';
        if (slideSize) stage.style.width = Math.ceil(slideSize.width + 40) + 'px';

        // worker markup relies on element-scoped styles; scope them to the stage
        var stageCss = document.createElement('style');
        stageCss.textContent =
          '#faithful-stage section{position:relative;text-align:center;overflow:hidden}' +
          '#faithful-stage section div.block{position:absolute;top:0;left:0;width:100%}' +
          '#faithful-stage section div.content{display:flex;flex-direction:column}' +
          '#faithful-stage section table{position:absolute}' +
          '#faithful-stage section svg.drawing{position:absolute;overflow:visible}' +
          globalCss.replace(/\.pslide /g, '#faithful-stage section ');
        stage.appendChild(stageCss);

        var holder = document.createElement('div');
        holder.appendChild(parseNodes(slideHtmls.join('\n')));
        stage.appendChild(holder);
        document.body.appendChild(stage);

        var hasCharts = false;
        var chartsOk = true;
        if (chartQueue.length && global.nv && global.d3) {
          onProgress(100, 100, 'Drawing ' + chartQueue.length + ' chart' + (chartQueue.length > 1 ? 's' : '') + '…');
          chartQueue.forEach(function (q) {
            try { if (renderChart(q.data)) hasCharts = true; }
            catch (err) { chartsOk = false; }
          });
        }

        setTimeout(function () {
          try {
            var sections = holder.querySelectorAll('section');
            var out = [];
            for (var i = 0; i < sections.length; i++) {
              var sec = sections[i];
              // freeze nvd3 svg dimensions so they survive without the library
              var svgs = sec.querySelectorAll('svg');
              for (var s = 0; s < svgs.length; s++) {
                var r = svgs[s].getBoundingClientRect();
                if (r.width && r.height && !svgs[s].classList.contains('drawing')) {
                  svgs[s].setAttribute('width', Math.round(r.width));
                  svgs[s].setAttribute('height', Math.round(r.height));
                }
              }
              var div = document.createElement('div');
              div.className = 'pslide';
              div.setAttribute('style', sec.getAttribute('style') || '');
              while (sec.firstChild) div.appendChild(sec.firstChild);
              out.push(div.outerHTML);
            }
            document.body.removeChild(stage);
            worker.terminate();
            if (!out.length) { fail('The layout renderer produced no slides.'); return; }
            settled = true;
            resolve({
              slides: out,
              slideSize: slideSize || { width: 960, height: 720 },
              globalCss: globalCss,
              hasCharts: hasCharts,
              chartsOk: chartsOk
            });
          } catch (err) {
            if (stage.parentNode) document.body.removeChild(stage);
            fail('Could not assemble the rendered slides: ' + err.message);
          }
        }, chartQueue.length ? CHART_SETTLE_MS : 30);
      }

      worker.postMessage({ type: 'processPPTX', data: arrayBuffer });
    });
  }

  global.FaithfulRenderer = { render: render };

})(window);
