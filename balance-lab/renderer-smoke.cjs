const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

module.exports = async function verifyRenderer(catalog, preview, runResult) {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'renderer/index.html'), 'utf8'), { runScripts: 'outside-only' });
  const window = dom.window;
  const $ = id => window.document.getElementById(id);
  let submitted;
  window.balanceLab = { getCatalog: async () => catalog, onProgress: () => {},
    preview: async () => preview, run: async payload => { submitted = payload; return runResult; } };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new window.Event('change')); };
  try {
    window.eval(fs.readFileSync(path.join(__dirname, 'renderer/app.js'), 'utf8'));
    await flush();
    assert.equal($('routeModel').value, 'hex');
    assert.equal($('location').options.length, 6);
    change('location', 'restless_ruins');
    assert.equal($('runButton').disabled, false);
    assert.equal($('finderButton').disabled, false);
    assert.equal($('previewButton').disabled, false);
    $('previewButton').click();
    await flush();
    assert.equal($('mapPreview').querySelectorAll('polygon').length, preview.layout.cells.length);
    assert.ok(!$('mapPreview').innerHTML.includes('NaN'));
    change('location', 'fungal');
    assert.equal($('templateId').options.length, 5);
    change('templateId', 'fungal-03');
    change('sublocationSlot', '2');
    change('preferredCurseId', 'withering');
    $('runButton').click();
    await flush();
    assert.equal(submitted.routeModel, 'hex');
    assert.equal(submitted.templateId, 'fungal-03');
    assert.equal(submitted.sublocationSlot, 2);
    assert.equal(submitted.hexCraftPolicy, 'moderate');
    assert.equal(submitted.altarPolicy, 'accept');
    assert.equal(submitted.preferredCurseId, 'withering');
    assert.equal(Object.keys(submitted.initialCurses).length, 5);
    assert.ok($('resultBody').textContent.includes('fungal-03'));
    change('routeModel', 'legacy');
    assert.equal($('location').options.length, 3);
    assert.equal($('routePolicy').disabled, false);
    assert.equal($('hexControls').classList.contains('hidden'), true);
  } finally { window.close(); }
};
