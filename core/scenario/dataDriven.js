'use strict';
const fs = require('fs');
const path = require('path');
const { siteDir } = require('../siteConfig');

function dataDir(siteId) {
  return path.join(siteDir(siteId), 'data');
}

function dataFile(siteId, name) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`invalid data set name: ${name}`);
  // The file must stay inside the site's data directory, whatever the name contains.
  const directory = path.resolve(dataDir(siteId));
  const file = path.resolve(directory, `${name}.csv`);
  if (!file.startsWith(`${directory}${path.sep}`)) throw new Error(`invalid data set name: ${name}`);
  return file;
}

/** Lists available data-set names (CSV files, extension stripped) for a site. */
function listDataSets(siteId) {
  const dir = dataDir(siteId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.csv'))
    .map((f) => f.slice(0, -4));
}

/** Parses one CSV line honoring double-quote escaping ("" -> "), returns an array of cells. */
function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

/** Reads a data set as an array of row objects keyed by the CSV header row. */
function readDataSet(siteId, name) {
  const file = dataFile(siteId, name);
  if (!fs.existsSync(file)) throw new Error(`data set not found: ${name}`);
  const lines = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    header.forEach((key, index) => {
      row[key] = cells[index] ?? '';
    });
    return row;
  });
}

function writeDataSet(siteId, name, rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('data set requires at least one row');
  const header = Object.keys(rows[0]);
  const escape = (value) => {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(','), ...rows.map((row) => header.map((key) => escape(row[key])).join(','))];
  fs.mkdirSync(dataDir(siteId), { recursive: true });
  fs.writeFileSync(dataFile(siteId, name), lines.join('\n') + '\n', 'utf8');
}

/**
 * Builds one variable-override map per row of a data set, for driving repeated
 * execution of the same scenario/test case with different data (data-driven testing).
 */
function buildVariableOverridesPerRow(siteId, dataSetName) {
  return readDataSet(siteId, dataSetName).map((row) => ({ ...row }));
}

module.exports = { listDataSets, readDataSet, writeDataSet, buildVariableOverridesPerRow };
