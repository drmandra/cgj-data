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
var COLORS = ['#4a7ba6', '#c4531d', '#3f8f5c', '#8a6d1f', '#6b4e8a',
              '#b03a5b', '#2f7f8f', '#7a7a3d', '#a0522d', '#4d4d8f'];

// Code
var chart = null;   // remember current chart so we can replace later
var allRows = null; // holds the parsed CSV so everything can be redrawn without reloading the CSV

// load data once
fetch('data/' + DATA_FILE_NAME)
    .then(function (response) { return response.text(); })
    .then(function (text) {
        allRows = parseCSV(text);
        buildDropdown();
        applyURL();
        draw();
    })
    .catch(function (error) {
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

    document.getElementById('exclude-bos').addEventListener('change', draw);
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

    updateURL(key, excludeBOS, splitKey, stackMode);

    var result = countGrid(allRows, view.columns, splitCols, excludeBOS, view.sort);
    renderChart(result.labels, result.series, view.label, splitKey === 'none' ? 'grouped' : stackMode);
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
            splitValues.push('Number of reports');
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
    var canvas = document.getElementById('chart');
    if (chart) chart.destroy();

    var percent = (stackMode === 'percent');
    var stacked = (stackMode === 'stacked' || percent);

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
            plugins: {
                title: { display: true, text: 'Reports by ' + title },
                legend: { display: datasets.length > 1 },
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
                x: { stacked: stacked },
                y: {
                    stacked: stacked,
                    beginAtZero: true,
                    max: percent ? 100 : undefined,
                    ticks: percent ? { callback: function(v) { return v + '%'; } } : { precision: 0 }
                }
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

// Write: put the current control state in address bar
function updateURL(key, excludeBOS, splitKey, stackMode) {
    var params = new URLSearchParams();
    params.set('view', key);
    params.set('split', splitKey);
    params.set('stack', stackMode);

    if (excludeBOS) params.set('excludeBOS', 'true');
    var newURL = window.location.pathname + '?' + params.toString()
    history.replaceState(null, '', newURL);
}

// Read the url and pull save state out of url
function readURL() {
    var params = new URLSearchParams(window.location.search);
    return {
        view: params.get('view'),
        split: params.get('split'),
        stack: params.get('stack'),
        excludeBOS: params.get('excludeBOS') === 'true'
    };
}

// Set dropdown/checkbox to match URL
function applyURL() {
    var state = readURL();

    if (state.view && VIEWS[state.view]) { // make sure it's a real view
        document.getElementById('view-select').value = state.view;
    }

    rebuildSplitOptions(document.getElementById('view-select').value);

    if (state.split && document.querySelector('#split-select option[value="' + state.split + '"]')) {      
        document.getElementById('split-select').value = state.split;
    }

    if (state.stack === 'grouped' || state.stack === 'stacked' || state.stack === 'percent') {
        document.getElementById('stack-select').value = state.stack;     
    }

    document.getElementById('exclude-bos').checked = state.excludeBOS;
}

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