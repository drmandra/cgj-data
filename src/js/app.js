/** does all the javascript for displaying charts for Civil Grand Jury data
 * 
 * Created: 10 July 2026
 * 
 * Using charts.js 4.5.0
**/

// Statics
var DATA_FILE_NAME = 'cgjdata.csv';
var VIEWS = {
    year:     { label: 'Year',     columns: [0],    sort: 'label' },
    category: { label: 'Category', columns: [2, 3], sort: 'count' },
    entity:   { label: 'Entity',   columns: [4, 5], sort: 'count' },
    location: { label: 'Location', columns: [6],    sort: 'count' }
};
// keeping these in case I like them more
// var COLORS = ['#a6cee3','#1f78b4','#b2df8a','#33a02c','#fb9a99','#e31a1c','#fdbf6f','#ff7f00',
//              '#cab2d6','#6a3d9a','#ffff99','#b15928']; 
var COLORS = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2','#59a14f', '#edc948', '#b07aa1', 
              '#ff9da7', '#9c755f', '#b9b1ad']
var YEAR_COL = 0;

// Code
var chart = null;   // remember current chart so we can replace later
var allRows = null; // holds the parsed CSV so everything can be redrawn without reloading the CSV
var allYears = [];

// load data once
fetch('data/' + DATA_FILE_NAME)
    .then(function (response) { return response.text(); })
    .then(function (text) {
        // parse
        allRows = parseCSV(text);
        allYears = collectYears(allRows);
        
        // build everything first
        buildDropdown();
        buildYearDropdowns();
        buildDrillX();
        rebuildDrillY();
        rebuildDrillValues();

        // apply URL
        applyURL();

        // draw charts
        draw();
        drawDrill();
    })
    .catch(function (error) {
        console.error(error);
        document.getElementById('error').textContent = 'Error: ' + error;
    });


function parseCSV(text) {
    var clean = text.trim().replace(/\r/g, ''); // drop trailing carriage return
    var lines = clean.split('\n');              // one string per row

    return lines.map(function (line) {
        return line.split(',').map(function (cell) { // one string per column
            return cell.trim();
        });
    });
}

function collectYears(rows) {
    var seen = {};
    rows.slice(1).forEach(function (cells) {
        var year = cells[YEAR_COL];
        if (year !== undefined && year !== '') seen[year] = true;
    });
    return Object.keys(seen).sort(function (a,b) {
        return a.localeCompare(b, undefined, { numeric: true });
    });
}


/* ============================================================
   QUICK-GLACE VIEW
   Aka View 1. Charts meant for quick glance
============================================================ */

function buildYearDropdowns() {
    var from = document.getElementById('from-year');
    var to = document.getElementById('to-year');

    allYears.forEach(function (year) {
        var o1 = document.createElement('option');
        o1.value = year;
        o1.textContent = year;
        from.appendChild(o1);

        var o2 = document.createElement('option');
        o2.value = year;
        o2.textContent = year;
        to.appendChild(o2);
    });

    from.value = allYears[0]; // full range as default
    to.value = allYears[allYears.length - 1];

    // year filtering
    document.getElementById('from-year').addEventListener('change', draw);
    document.getElementById('to-year').addEventListener('change', draw);
}

function buildDropdown() {
    var select = document.getElementById('view-select');

    Object.keys(VIEWS).forEach(function (key) {
        var option = document.createElement('option');
        option.value = key;                     // e.g. 'entity'
        option.textContent = VIEWS[key].label; // e.g. 'Entity'
        select.appendChild(option);
    });

    // when user picks a different option, redraw
    select.addEventListener('change', draw);

    // Event listeners:
    // exclude board of supervisors checkbox
    document.getElementById('exclude-bos').addEventListener('change', draw);
    
    // split and stack filters
    document.getElementById('split-select').addEventListener('change', draw);
    document.getElementById('stack-select').addEventListener('change', draw);

}

function rebuildSplitOptions(groupKey) {
    var select = document.getElementById('split-select');
    var previous = select.value;
    select.innerHTML = '';

    var none = document.createElement('option');
    none.value = 'none';
    none.textContent = '- none -';
    select.appendChild(none);

    Object.keys(VIEWS).forEach(function (k) {
        if (k === groupKey) return; // can't split by group field
        var o = document.createElement('option');
        o.value = k;
        o.textContent = VIEWS[k].label;
        select.appendChild(o)
    });

    // keep previous choice if it's still on menu
    var stillThere = select.querySelector('option[value="' + previous + '"]');
    select.value = stillThere ? previous : 'none';
}

function draw() {
    var key = document.getElementById('view-select').value;
    var view = VIEWS[key];

    rebuildSplitOptions(key);

    var splitKey = document.getElementById('split-select').value;
    var splitCols = (splitKey === 'none') ? null : VIEWS[splitKey].columns;

    // BOS is in entity field. offer toggle if it is on either axis
    document.getElementById('exclude-bos-wrap').hidden = (key !== 'entity' && splitKey !== 'entity');
    var excludeBOS = document.getElementById('exclude-bos').checked;

    document.getElementById('stack-wrap').hidden = (splitKey === 'none');
    var stackMode = document.getElementById('stack-select').value;

    var fromYear = document.getElementById('from-year').value;
    var toYear = document.getElementById('to-year').value;

    updateURL();

    var rows = filterByYear(allRows, fromYear, toYear); // filter by year first
    var result = countGrid(rows, view.columns, splitCols, excludeBOS, view.sort);
    renderChart(result.labels, result.series, view.label, splitKey === 'none' ? 'grouped' : stackMode);
}

function filterByYear(rows, fromYear, toYear) {
    // debug log
    // console.log('filterByYear got:', fromYear, toYear, 'types:', typeof fromYear, typeof toYear);

    var header = rows[0]; // extract headers
    var body = rows.slice(1).filter(function (cells) {
        var year = cells[YEAR_COL];

        return year.localeCompare(fromYear, undefined, { numeric: true }) >= 0 &&
               year.localeCompare(toYear,   undefined, { numeric: true }) <= 0;

    });
    // console.log('filtered from', rows.length, 'to', body.length + 1, 'rows');
    // put headers back, making sure we preserve the headers for countGrid
    return [header].concat(body);
}

function countGrid(rows, groupCols, splitCols, excludeBOS, sortMode) {
    var tally = {};    // groupValue -> { splitValue -> count }
    var totals = {};   // groupValue -> total count for sorting
    var groupOrder = [];
    var splitOrder = [];

    function keep(value) { // what we count
        if (value === undefined || value === '') return false;
        if (excludeBOS && value === 'Board of Supervisors') return false;
        return true;
    }

    rows.slice(1).forEach(function (cells) {
        // every group value this row contributes to
        var groupValues = [];
        groupCols.forEach(function (ci) {
            if (keep(cells[ci])) groupValues.push(cells[ci]);
        });

        // every split value this row contributes to
        var splitValues = [];
        if (splitCols === null) {
            splitValues.push('Appearances');
        } else {
            splitCols.forEach(function (ci) {
                if (keep(cells[ci])) splitValues.push(cells[ci]);
            });
        }

        groupValues.forEach(function (g) {
            if (!(g in tally)) { tally[g] = {}; totals[g] = 0; groupOrder.push(g); }
            splitValues.forEach(function (s) {
                if (splitOrder.indexOf(s) === -1) splitOrder.push(s);
                if (!(s in tally[g])) tally[g][s] = 0;
                tally[g][s] += 1;
                totals[g] += 1;
            });
        });
    });

    if (sortMode === 'count') {
        groupOrder.sort(function (a, b) { return (totals[b] - totals[a]) || a.localeCompare(b); });
    } else {
        groupOrder.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
    }

    splitOrder.sort(function (a, b) {return a.localeCompare(b, undefined, { numeric: true}); });

    var series = splitOrder.map(function (s) {
        return {
            name: s,
            data: groupOrder.map(function (g) { return tally[g][s] || 0; })
        };
    });

    return { labels: groupOrder, series: series };
}

function renderChart(labels, series, title, stackMode) {
    // console.log('labels length:', labels.length, 'labels:', labels);

    var canvas = document.getElementById('chart');
    if (chart) chart.destroy();


    var percent = (stackMode === 'percent');
    var stacked = (stackMode === 'stacked' || percent);

    // give each category a vertical slice so labels never collide
    var pxPerBar = (percent || stacked) ? 4 : 52;
    var minHeight = 200;
    var barsPerGroup = series.length;
    var innerHeight = Math.max(minHeight, labels.length * pxPerBar * barsPerGroup);
    canvas.parentNode.style.height = innerHeight + 'px';

    // 100% mode needs total to convert into shares
    var columnTotals = labels.map(function (_, i) {
        return series.reduce(function (sum, s) { return sum + s.data[i]; }, 0);
    });

    var datasets = series.map(function (s, i) {
        return {
            label: s.name,
            data: percent
                ? s.data.map(function (v, i2) { 
                    return columnTotals[i2] ? (v / columnTotals[i2] * 100) : 0; 
                })
                : s.data,
            rawCounts: s.data,  // keeping real numbers for tooltips
            backgroundColor: COLORS[i % COLORS.length]
        };
    });

    chart = new Chart(canvas, {
        type: 'bar',
        data: { labels: labels, datasets: datasets },
        options: {
            indexAxis: 'y',
            onClick: function (event, elements) {
                if (!elements.length) return;

                var el = elements[0];
                var groupValue = chart.data.labels[el.index];
                var seriesValue = chart.data.datasets[el.datasetIndex].label;

                var groupKey = document.getElementById('view-select').value;
                var splitKey = document.getElementById('split-select').value;

                if (splitKey === 'none') {
                    // single series
                    showReports(null, null,
                                VIEWS[groupKey].columns, groupValue,
                                'overview-report-list');
                } else {
                    showReports(VIEWS[groupKey].columns[0], groupValue,
                                VIEWS[splitKey].columns, seriesValue,
                                'overview-report-list');
                }
            },
            maintainAspectRatio: false,
            responsive: true,
            datasets: {
                bar: {
                    barPercentage: 0.9,
                    categoryPercentage: 0.9
                }
            },
            plugins: {
                title: { display: true, text: 'Reports by ' + title },
                legend: { display: true },
                tooltip: {
                    callbacks: {
                        label: function (ctx) {
                            var raw = ctx.dataset.rawCounts[ctx.dataIndex];
                            return percent
                                ? ctx.dataset.label + ': ' + raw + ' (' + Math.round(ctx.parsed.y) + '%'
                                : ctx.dataset.label + ': ' + raw;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: stacked,
                    position: 'top',
                    beginAtZero: true,
                    max: percent ? 100 : undefined,
                    ticks: percent ? { callback: function(v) { return v + '%'; } } : { precision: 0 }
                },
                y: { stacked: stacked }
            }
        }
    });
}


// used to draw a table from the csv. not used on site
function renderTable(rows) {
    var table = document.createElement('table');

    rows.forEach(function (cells, i) {
        var tr = document.createElement('tr');
        cells.forEach(function (cell) {
            var el = document.createElement(i == 0 ? 'th' : 'td') // first row is our headers
            el.textContent = cell;
            tr.appendChild(el);
        });
        table.appendChild(tr);
    });

    var output = document.getElementById('output');
    output.innerHTML = ''; // clear our 'Loading..' text
    output.appendChild(table);
}


/* ============================================================
   DRILL-DOWN VIEW
   Aka View 2 and independent of View 1
============================================================ */
var drillChart = null;

// Two field menus. X can be any field, Y excludes Year and X
// constants
var DRILL_X_FIELDS = ['year', 'category', 'entity', 'location'];
var DRILL_Y_FIELDS = ['category', 'entity', 'location'];

// Filter rows to those where X field equals xValue and count the Y field's 
// values and return themn sorted high-to-low
function countRanked(rows, xCol, xValue, yCols) { 
    var tally = {};
    var order = [];

    rows.slice(1).forEach(function (cells) {
        if (cells[xCol] !== xValue) return;   // keep only chosen X value

        yCols.forEach(function (yCol) {
            var value = cells[yCol];
            if (value === undefined || value === '') return;
            if (!(value in tally)) { tally[value] = 0; order.push(value); }
            tally[value] += 1;
        });
    });

    order.sort(function (a,b) {
        return (tally[b] - tally[a]) || a.localeCompare(b);
    });

    return {
        labels: order,
        values: order.map(function (v) { return tally[v]; })
    };
}

// Build X menu once as its options never change
function buildDrillX() {
    var sel = document.getElementById('drill-x');
    DRILL_X_FIELDS.forEach(function (key) {
        var o = document.createElement('option');
        o.value = key;
        o.textContent = VIEWS[key].label;
        sel.appendChild(o)
    });

    sel.addEventListener('change', onDrillXChange);
}

// Y menu: all DRILL_Y_FIELDS except what is currently X
function rebuildDrillY() {
    var xKey = document.getElementById('drill-x').value;
    var sel = document.getElementById('drill-y');
    var previous = sel.val;
    sel.innerHTML = '';

    DRILL_Y_FIELDS.forEach(function (key) {
        if (key === xKey) return;
        var o = document.createElement('option');
        o.value = key;
        o.textContent = VIEWS[key].label;
        sel.appendChild(o);
    });

    var stillThere = sel.querySelector('option[value="' + previous + '"]');
    sel.value = stillThere ? previous : sel.options[0].value;
    sel.onchange = drawDrill;
}

// Value menu: the distinct values of the current X field
function rebuildDrillValues() {
    var xKey = document.getElementById('drill-x').value;
    var xCol = VIEWS[xKey].columns[0];
    var sel = document.getElementById('drill-value');
    var previous = sel.value;
    sel.innerHTML = '';

    var seen = {}, vals = [];
    allRows.slice(1).forEach(function (cells) {
        var v = cells[xCol];

        if (v !== undefined && v !== '' && !(v in seen)) { seen[v] = true; vals.push(v); }
    });

    vals.sort(function (a,b) { 
        return a.localeCompare(b, undefined, { numeric: true });
    });

    vals.forEach(function (v) {
        var o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        sel.appendChild(o);
    });

    var stillThere = sel.querySelector('option[value="' + previous + '"]');
    sel.value = stillThere ? previous : sel.options[0].value;
    sel.onchange = drawDrill;
}

// When X changes rebuild BOTH dependent menus then redraw
function onDrillXChange() {
    rebuildDrillY();
    rebuildDrillValues();
    drawDrill();
}

// Drawing/rendering
function drawDrill() {
    var xKey = document.getElementById('drill-x').value;
    var yKey = document.getElementById('drill-y').value;
    var xValue = document.getElementById('drill-value').value;

    var xCol = VIEWS[xKey].columns[0];
    var yCols = VIEWS[yKey].columns;

    updateURL();

    var result = countRanked(allRows, xCol, xValue, yCols);
    renderDrillChart(result.labels, result.values,
                    VIEWS[yKey].label + ' in ' + VIEWS[xKey].label + ' = ' + xValue);
}

function renderDrillChart(labels, values, title) {
    var canvas = document.getElementById('drill-chart');
    if (drillChart) drillChart.destroy();

    var pxPerBar = 52;
    var minHeight = 200;
    canvas.parentNode.style.height = Math.max(minHeight, labels.length * pxPerBar) + 'px';

    drillChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ label: 'Count', data: values, backgroundColor: COLORS[0] }]
        },
        options: {
            indexAxis: 'y',
            onClick: function (event, elements) {
                if (!elements.length) return;

                var yValue = drillChart.data.labels[elements[0].index];

                var xKey = document.getElementById('drill-x').value;
                var yKey = document.getElementById('drill-y').value;
                var xValue = document.getElementById('drill-value').value;

                showReports(
                    VIEWS[xKey].columns[0], xValue,
                    VIEWS[yKey].columns, yValue,
                    'drill-report-list'
                );
            },
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: title },
                legend: { display: false }
            },
            scales: {
                x: { beginAtZero: true, ticks: { precision: 0 } },
                y: {}
            }
        }
    });
}

/* ============================================================
   REPORT LIST (shared by both charts)
   Given the field/value context of a clicked bar, find the
   matching reports and render them (title + links) into a
   given container, then scroll it into view.
   ============================================================ */
// Constants
var YEAR_COL = 0;
var TITLE_COL = 1;
var LINK1_COL = 7;
var LINK2_COL = 8;
var LINK3_COL = 9;

// Find rows matching the clicked bar, render them and scroll to them
// xCol/xValue: the field+value being held fixed (may be null if none)
// yCols/yValue: the field+value the clicked bar represents
// containerId: which report list to fill
function showReports(xCol, xValue, yCols, yValue, containerId) {
    var matches = allRows.slice(1).filter(function (cells) {
        var x0k = (xCol === null) || (cells[xCol] === xValue);
        var y0k = yCols.some(function (c) { return cells[c] === yValue; });
        return x0k && y0k;
    });

    renderReportTable(matches, containerId);

    // scroll to table
    document.getElementById(containerId).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderReportTable(rows, containerId) {
    var container = document.getElementById(containerId);
    container.innerHTML = '';

    var heading = document.createElement('p');
    heading.textContent = rows.length + ' report' + (rows.length === 1 ? '' : 's');
    container.appendChild(heading);

    if (!rows.length) return;

    var table = document.createElement('table');
    rows.forEach(function (cells) {
        var tr = document.createElement('tr');

        var yearTd = document.createElement('td');
        var a = document.createElement('a');
        a.href = 'https://www.santacruzcountyca.gov/Departments/GrandJury/' + (cells[YEAR_COL] - 1) +
        '-' + cells[YEAR_COL] + 'GrandJuryReportsandResponses.aspx';
        a.textContent = cells[YEAR_COL];
        a.target = '_blank';
        a.rel = 'noopener';
        yearTd.appendChild(a);
        yearTd.appendChild(document.createTextNode(' '));

        tr.appendChild(yearTd);

        var titleTd = document.createElement('td');
        titleTd.textContent = cells[TITLE_COL];
        tr.appendChild(titleTd);

        var linkTd = document.createElement('td');
        [cells[LINK1_COL], cells[LINK2_COL], cells[LINK3_COL]].forEach(function (url, i) {
            if (url && url !== '') {
                var a = document.createElement('a');
                a.href = url;

                if (i === 2) { linkString = 'Response 2'; }
                else if (i === 1) { linkString = 'Reponse 1'; }
                else { linkString = 'Report'; }

                a.textContent = linkString;
                a.target = '_blank';
                a.rel = 'noopener';
                linkTd.appendChild(a);
                linkTd.appendChild(document.createTextNode(' '));
            }
        });
        tr.appendChild(linkTd);

        table.appendChild(tr);
    });
    container.appendChild(table);
}


/* ============================================================
   URL FUNCTIONS
============================================================ */

// Write: put the current control state in address bar
function updateURL() {
    var params = new URLSearchParams();

    // view 1 state
    params.set('v', document.getElementById('view-select').value);
    params.set('sp', document.getElementById('split-select').value);
    params.set('st', document.getElementById('stack-select').value);
    params.set('from', document.getElementById('from-year').value);
    params.set('to', document.getElementById('to-year').value);
    if (document.getElementById('exclude-bos').checked) params.set('excludeBOS', 'true');

    // view 2 state
    params.set('dx', document.getElementById('drill-x').value);
    params.set('dy', document.getElementById('drill-y').value);
    params.set('dval', document.getElementById('drill-value').value);

    history.replaceState(null, '', window.location.pathname + '?' + params.toString());
}

function readURL() {
    var params = new URLSearchParams(window.location.search);

    return {
        v: params.get('v'),
        sp: params.get('sp'),
        st: params.get('st'),
        from: params.get('from'),
        to: params.get('to'),
        excludeBOS: params.get('excludeBOS') === 'true',
        dx: params.get('dx'),
        dy: params.get('dy'),
        dval: params.get('dval')
    };
}

function applyURL() {
    var state = readURL();

    // View 1
    if (state.v && VIEWS[state.v]) { // make sure it's a real view
        document.getElementById('view-select').value = state.v;
    }

    rebuildSplitOptions(document.getElementById('view-select').value);

    if (state.sp && document.querySelector('#split-select option[value="' + state.sp + '"]')) {      
        document.getElementById('split-select').value = state.sp;
    }

    if (state.st === 'grouped' || state.st === 'stacked' || state.st === 'percent') {
        document.getElementById('stack-select').value = state.st;     
    }

    document.getElementById('exclude-bos').checked = state.excludeBOS;

    if (state.from && document.querySelector('#from-year option[value="' + state.from + '"]')) {
        document.getElementById('from-year').value = state.from;
    }

    if (state.to && document.querySelector('#to-year option[value="' + state.to + '"]')) {
        document.getElementById('to-year').value = state.to;
    }

    // View 2
    if (state.dx && VIEWS[state.dx]) {
        document.getElementById('drill-x').value = state.dx;
    }

    rebuildDrillY();
    rebuildDrillValues();

    if (state.dy && document.querySelector('#drill-y option[value="' + state.dy + '"]')) {
        document.getElementById('drill-y').value = state.dy;
    }

    if (state.dval && document.querySelector('#drill-value option[value="' + state.dval + '"]')) {
        document.getElementById('drill-value').value = state.dval;
    }
}

// old urls
// function updateURL(key, excludeBOS, splitKey, stackMode, fromYear, toYear) {
//     var params = new URLSearchParams();
//     params.set('view', key);
//     params.set('split', splitKey);
//     params.set('stack', stackMode);
//     params.set('from', fromYear);
//     params.set('to', toYear);

//     if (excludeBOS) params.set('excludeBOS', 'true');
//     var newURL = window.location.pathname + '?' + params.toString()
//     history.replaceState(null, '', newURL);
// }

// // Read the url and pull save state out of url
// function readURL() {
//     var params = new URLSearchParams(window.location.search);
//     return {
//         view: params.get('view'),
//         split: params.get('split'),
//         stack: params.get('stack'),
//         excludeBOS: params.get('excludeBOS') === 'true',
//         from: params.get('from'),
//         to: params.get('to')
//     };
// }

// // Set dropdown/checkbox to match URL
// function applyURL() {
//     var state = readURL();

//     if (state.view && VIEWS[state.view]) { // make sure it's a real view
//         document.getElementById('view-select').value = state.view;
//     }

//     rebuildSplitOptions(document.getElementById('view-select').value);

//     if (state.split && document.querySelector('#split-select option[value="' + state.split + '"]')) {      
//         document.getElementById('split-select').value = state.split;
//     }

//     if (state.stack === 'grouped' || state.stack === 'stacked' || state.stack === 'percent') {
//         document.getElementById('stack-select').value = state.stack;     
//     }

//     document.getElementById('exclude-bos').checked = state.excludeBOS;

//     if (state.from && document.querySelector('#from-year option[value="' + state.from + '"]')) {
//         document.getElementById('from-year').value = state.from;
//     }

//     if (state.to && document.querySelector('#to-year option[value="' + state.to + '"]')) {
//         document.getElementById('to-year').value = state.to;
//     }
// }

// prototype counting now deprecated
// function countAcrossColumns(rows, colIndexes, excludeBOS, sortMode) {
//     var tally = [];
//     var order = [];

//     rows.slice(1).forEach(function (cells) { // skip header row
//         colIndexes.forEach(function (colIndex) { // look at each combined column
//             var value = cells[colIndex];
//             if (value === undefined || value === '' || 
//                 (excludeBOS && value === 'Board of Supervisors')) return;
//             if (!(value in tally)) { tally[value] = 0; order.push(value); }
//             tally[value] += 1;
//         });
//     });

//     if (sortMode === 'count') {
//         // biggest first then alphabetical
//         order.sort(function (a, b) {
//             return (tally[b] - tally[a]) || a.localeCompare(b);
//         });
//     } else if (sortMode === 'label') {
//         // alphabetical/chronological
//         order.sort(function (a, b) {
//             return a.localeCompare(b, undefined, { numeric: true});
//         });
//     }
//     return {
//         labels: order,
//         values: order.map(function (v) { return tally[v]; })
//     };
// }

// old renderChart
// function renderChart(labels, values, columnName) {
//     var canvas = document.getElementById('chart');

//     if (chart) chart.destroy(); // clear previous charts before drawing new ones

//     chart = new Chart(canvas, {
//         type: 'bar',
//         data: {
//             labels: labels,
//             datasets: [{
//                 label: 'Number of reports',
//                 data: values,
//                 backgroundColor: '#4a7ba6'
//             }]
//         },
//         options: {
//             plugins: {
//                 title: { display: true, text: 'Reports by: ' + columnName}
//             },
//             scales: {
//                 y: { beginAtZero: true, ticks: { precision: 0 } }
//             }
//         }
//     });
// }

// old draw
// function draw() {
//     var key = document.getElementById('view-select').value; 
//     var view = VIEWS[key];

//     // show exclude BOS checkbox when on 'entity'
//     var wrap = document.getElementById('exclude-bos-wrap');
//     wrap.hidden = ( key !== 'entity');

//     // read if box is checked
//     var excludeBOS = document.getElementById('exclude-bos').checked;

//     updateURL(key, excludeBOS);

//     var counts = countAcrossColumns(allRows, view.columns, excludeBOS, view.sort);
//     renderChart(counts.labels, counts.values, view.label);
// }