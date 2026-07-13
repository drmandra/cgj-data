/** does all the javascript for displaying charts for Civil Grand Jury data
 * 
 * Created: 10 July 2026
 * 
 * Using charts.js 4.5.0
**/

// Statics
var DATA_FILE_NAME = 'cgjdata.csv';
var VIEWS = {
    year:     { label: 'Year', columns: [0] },
    category: { label: 'Category', columns: [2, 3] },
    entity:   { label: 'Entity', columns: [4, 5] },
    location: { label: 'Location', columns: [6] }
};

// Code
var chart = null;   // remember current chart so we can replace later
var allRows = null; // holds the parsed CSV so everything can be redrawn without reloading the CSV

// load data once
fetch('data/' + DATA_FILE_NAME)
    .then(function (response) { return response.text(); })
    .then(function (text) {
        allRows = parseCSV(text);
        buildDropdown();
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

}

function draw() {
    var key = document.getElementById('view-select').value; 
    var view = VIEWS[key];

    // show exclude BOS checkbox when on 'entity'
    var wrap = document.getElementById('exclude-bos-wrap');
    wrap.hidden = ( key !== 'entity');

    // read if box is checked
    var excludeBOS = document.getElementById('exclude-bos').checked;

    var counts = countAcrossColumns(allRows, view.columns, excludeBOS);
    renderChart(counts.labels, counts.values, view.label);
}

function countAcrossColumns(rows, colIndexes, excludeBOS) {
    var tally = [];
    var order = [];

    rows.slice(1).forEach(function (cells) { // skip header row
        colIndexes.forEach(function (colIndex) { // look at each combined column
            var value = cells[colIndex];
            if (value === undefined || value === '' || 
                (excludeBOS && value === 'Board of Supervisors')) return;
            if (!(value in tally)) { tally[value] = 0; order.push(value); }
            tally[value] += 1;
        });
    });
    return {
        labels: order,
        values: order.map(function (v) { return tally[v]; })
    }
}

function renderChart(labels, values, columnName) {
    var canvas = document.getElementById('chart');

    if (chart) chart.destroy(); // clear previous charts before drawing new ones

    chart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Number of reports',
                data: values,
                backgroundColor: '#4a7ba6'
            }]
        },
        options: {
            plugins: {
                title: { display: true, text: 'Reports by: ' + columnName}
            },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } }
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
    output.appendChild(table)
}