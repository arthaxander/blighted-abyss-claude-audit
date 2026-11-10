(function() {
  const $ = function(id) { return document.getElementById(id); };
  let catalog = null;
  let lastExport = null;
  let busy = false;

  function option(select, value, text) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = text;
    select.appendChild(node);
  }

  function currentClass() {
    return catalog.classes.find(function(entry) { return entry.id === $('classId').value; });
  }

  function snapshot() {
    return catalog.profileSnapshots[$('classId').value] &&
      catalog.profileSnapshots[$('classId').value][$('profile').value];
  }

  function nameOf(value) {
    if (typeof value === 'string') return value;
    return value && (value.itemId || value.name) || '';
  }

  function humanClass(id) {
    const row = catalog.classes.find(function(entry) { return entry.id === id; });
    return row ? row.label : id;
  }

  function abilityLabel(id) {
    const cls = currentClass();
    const row = cls && cls.abilities.find(function(entry) { return entry.id === id; });
    return row ? row.name : id;
  }

  function passiveLabel(id) {
    const cls = currentClass();
    const row = cls && cls.passives.find(function(entry) { return entry.id === id; });
    return row ? row.name : id;
  }

  function talentLabel(id) {
    const cls = currentClass();
    let found = null;
    (cls && cls.talents || []).some(function(set) {
      const row = set.talents.find(function(entry) { return entry.id === id; });
      if (row) { found = row.name; return true; }
      return false;
    });
    return found || id;
  }

  function unsupported() {
    return $('routeModel').value === 'hex' && !catalog.hexLocations.find(entry => entry.id === $('location').value)?.combatSupported;
  }

  function updateMaps() {
    const hex = $('routeModel').value === 'hex';
    $('hexControls').classList.toggle('hidden', !hex);
    $('routePolicy').disabled = hex;
    $('templateId').replaceChildren();
    option($('templateId'), '', 'Случайная из набора (по seed)');
    const location = catalog.hexLocations.find(entry => entry.id === $('location').value);
    (location?.templates || []).forEach(entry => option($('templateId'), entry.id, entry.label));
    $('mapPreview').replaceChildren();
    $('hexNote').textContent = unsupported()
      ? 'Пока доступен только просмотр: для боевого расчёта нет готовых противников.'
      : 'Полная зачистка одной ветки. Рыбалка, смена найденной экипировки и эвакуация пока не моделируются.';
    $('altarRules').textContent = 'Этаж ' + location?.abyssLevel + ': ' + (location?.abyssLevel === 1 ? '1 алтарь, максимум I уровень одного проклятия.' : '2 алтаря, максимум II уровень одного проклятия.') + ' Общий предел — 13 уровней. Выше II развивается только одно главное проклятие.';
    setBusy(busy);
  }

  function updateLocations() {
    const previous = $('location').value;
    $('location').replaceChildren();
    const locations = $('routeModel').value === 'hex' ? catalog.hexLocations : catalog.locations;
    locations.forEach(entry => option($('location'), entry.id, entry.label));
    if (locations.some(entry => entry.id === previous)) $('location').value = previous;
    updateMaps();
  }

  async function previewMap() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.balanceLab.preview(gatherConfig());
      const cells = result.layout.cells;
      const projected = cells.map(cell => ({ cell, x: cell.q * 30, y: (cell.r + cell.q / 2) * 35 }));
      const minX = Math.min(...projected.map(p => p.x)) - 22;
      const minY = Math.min(...projected.map(p => p.y)) - 22;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', [minX, minY, Math.max(...projected.map(p => p.x)) - minX + 22, Math.max(...projected.map(p => p.y)) - minY + 22].join(' '));
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', result.layout.templateId);
      svg.style.width = '100%';
      const colors = { approach: '#668d6c', sublocation: '#a88d58', depth: '#736fbb', boss: '#c45b59' };
      projected.forEach(({cell, x, y}) => {
        const polygon = document.createElementNS(svg.namespaceURI, 'polygon');
        polygon.setAttribute('points', Array.from({ length: 6 }, (_, i) => {
          const angle = Math.PI / 3 * i;
          return [x + 19 * Math.cos(angle), y + 19 * Math.sin(angle)].join(',');
        }).join(' '));
        polygon.setAttribute('fill', colors[cell.region] || '#777');
        polygon.setAttribute('opacity', cell.significant ? '1' : '.45');
        const title = document.createElementNS(svg.namespaceURI, 'title');
        title.textContent = cell.id + ': ' + (cell.previewRoomType || cell.landmark?.type || 'проход');
        polygon.appendChild(title);
        svg.appendChild(polygon);
      });
      const caption = document.createElement('p');
      caption.textContent = result.layout.templateId + ' · ' + cells.length + ' гексов. Зелёный: подход; охра: ветки; фиолетовый: глубины; красный: босс. Наведи на гекс для деталей. Это схема наполнения, не результат боя.';
      $('mapPreview').replaceChildren(caption, svg);
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  }

  function setBusy(value) {
    busy = value;
    $('runButton').disabled = value || unsupported();
    $('finderButton').disabled = value || unsupported();
    $('previewButton').disabled = value;
    $('cancelButton').disabled = !value;
    $('status').textContent = value ? 'Выполняется…' : 'Готово к запуску';
    if (!value) $('progressBox').classList.add('hidden');
  }

  function showError(error) {
    $('resultTitle').textContent = 'Ошибка';
    $('resultBody').className = '';
    $('resultBody').innerHTML = '<div class="error"></div>';
    $('resultBody').querySelector('.error').textContent = error && (error.message || error) || 'Неизвестная ошибка';
  }

  function renderPreset() {
    const profile = catalog.profiles.find(function(entry) { return entry.id === $('profile').value; });
    const snap = snapshot() || {};
    const gear = Object.values(snap.equipment || {}).map(nameOf).filter(Boolean);
    const level = snap.classProgression && snap.classProgression.classLevel || 1;
    const relicLevel = snap.relic && snap.relic.level || 0;
    $('presetCard').innerHTML =
      '<div class="preset-title"><strong>' + profile.label + '</strong><span>класс ' + level + ' ур. · реликвия L' + relicLevel + '</span></div>' +
      '<div class="preset-meta">' + profile.description + '</div>' +
      '<div class="preset-items"><b>Снаряжение:</b> ' + (gear.join(', ') || 'стартовое') + '<br>' +
      '<b>Активные:</b> ' + ((snap.activeAbilityIds || []).map(abilityLabel).join(', ') || 'стартовые') + '<br>' +
      '<b>Пассивы:</b> ' + ((snap.passiveIds || []).map(passiveLabel).join(', ') || 'нет') + '<br>' +
      '<b>Расходники:</b> ' + ((snap.consumables || []).map(function(entry) { return entry.id + ' ×' + entry.quantity; }).join(', ') || 'нет') + '</div>';
    $('relicLevel').value = relicLevel;
    renderAdvanced();
  }

  function checkboxChoice(group, entry, checked, extra) {
    const label = document.createElement('label');
    label.className = 'choice';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = group;
    input.value = entry.id;
    input.checked = checked;
    const span = document.createElement('span');
    span.innerHTML = entry.name + (extra ? '<br><small>' + extra + '</small>' : '');
    label.appendChild(input);
    label.appendChild(span);
    return label;
  }

  function renderAdvanced() {
    if (!catalog) return;
    const cls = currentClass();
    const snap = snapshot() || {};
    const level = snap.classProgression && snap.classProgression.classLevel || 1;

    const abilities = $('abilities');
    abilities.innerHTML = '';
    cls.abilities.filter(function(entry) { return entry.requiredLevel <= level; }).forEach(function(entry) {
      abilities.appendChild(checkboxChoice('activeAbility', entry, (snap.activeAbilityIds || []).indexOf(entry.id) >= 0, 'ур. ' + entry.requiredLevel));
    });

    const passives = $('passives');
    passives.innerHTML = '';
    cls.passives.filter(function(entry) { return entry.requiredLevel <= level; }).forEach(function(entry) {
      passives.appendChild(checkboxChoice('passiveAbility', entry, (snap.passiveIds || []).indexOf(entry.id) >= 0, 'ур. ' + entry.requiredLevel));
    });

    const talents = $('talents');
    talents.innerHTML = '';
    cls.talents.filter(function(set) { return set.requiredLevel <= level; }).forEach(function(set) {
      const box = document.createElement('div');
      box.className = 'talent-set';
      const title = document.createElement('div');
      title.textContent = set.abilityName + ' · ур. ' + set.requiredLevel;
      const select = document.createElement('select');
      select.dataset.abilityId = set.abilityId;
      option(select, '', 'По профилю / без таланта');
      set.talents.forEach(function(talent) { option(select, talent.id, talent.name); });
      const selected = snap.classProgression && snap.classProgression.talentSelections &&
        snap.classProgression.talentSelections[set.abilityId];
      if (selected) select.value = selected;
      box.appendChild(title);
      box.appendChild(select);
      talents.appendChild(box);
    });
    if (!talents.children.length) talents.innerHTML = '<div class="preset-meta">Для этого профиля пока нет реализованных в симуляторе талантов.</div>';

    const gearRoot = $('equipment');
    gearRoot.innerHTML = '';
    catalog.equipmentSlots.forEach(function(slot) {
      const label = document.createElement('label');
      label.textContent = slot.label;
      const select = document.createElement('select');
      select.dataset.slot = slot.id;
      option(select, '', 'Пусто / по профилю');
      (catalog.equipmentByClass[$('classId').value] || []).filter(function(item) {
        return slot.types.indexOf(item.type) >= 0;
      }).forEach(function(item) {
        option(select, item.name, item.name);
      });
      const selected = nameOf((snap.equipment || {})[slot.id]);
      if (selected) select.value = selected;
      label.appendChild(select);
      gearRoot.appendChild(label);
    });

    const consumables = $('consumables');
    consumables.innerHTML = '';
    const presetCounts = {};
    (snap.consumables || []).forEach(function(entry) { presetCounts[entry.id] = entry.quantity; });
    catalog.consumables.forEach(function(item) {
      const row = document.createElement('label');
      row.className = 'consumable-row';
      const span = document.createElement('span');
      span.textContent = item.name;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '99';
      input.value = presetCounts[item.id] || 0;
      input.dataset.consumableId = item.id;
      row.appendChild(span);
      row.appendChild(input);
      consumables.appendChild(row);
    });
  }

  function bindToggle(toggleId, targetId) {
    $(toggleId).addEventListener('change', function() {
      $(targetId).classList.toggle('disabled', !$(toggleId).checked);
      if (targetId === 'relicLevel') $(targetId).disabled = !$(toggleId).checked;
    });
  }

  function gatherConfig() {
    const activeIds = Array.from(document.querySelectorAll('input[name="activeAbility"]:checked')).map(function(node) { return node.value; });
    const passiveIds = Array.from(document.querySelectorAll('input[name="passiveAbility"]:checked')).map(function(node) { return node.value; });
    const talentSelections = {};
    Array.from($('talents').querySelectorAll('select[data-ability-id]')).forEach(function(node) {
      if (node.value) talentSelections[node.dataset.abilityId] = node.value;
    });
    const equipment = {};
    Array.from($('equipment').querySelectorAll('select[data-slot]')).forEach(function(node) {
      if (node.value) equipment[node.dataset.slot] = node.value;
    });
    const consumables = Array.from($('consumables').querySelectorAll('input[data-consumable-id]')).map(function(node) {
      return { id: node.dataset.consumableId, quantity: Number(node.value) || 0 };
    }).filter(function(entry) { return entry.quantity > 0; });

    return {
      classId: $('classId').value,
      location: $('location').value,
      routeModel: $('routeModel').value,
      hexCraftPolicy: $('hexCraftPolicy').value,
      altarPolicy: $('altarPolicy').value,
      preferredCurseId: $('preferredCurseId').value || null,
      initialCurses: Object.fromEntries(catalog.curses.map(curse => [curse.id, Number($('curse-' + curse.id).value)])),
      templateId: $('templateId').value,
      sublocationSlot: Number($('sublocationSlot').value),
      profile: $('profile').value,
      runs: Number($('runs').value) || 1000,
      seed: Number($('seed').value) >>> 0,
      routePolicy: $('routePolicy').value,
      combatPolicy: $('combatPolicy').value,
      bossPolicy: $('bossPolicy').value,
      lootPolicy: 'balanced',
      gearPolicy: 'smart',
      craftPolicy: 'balanced',
      extractionPolicy: 'off',
      customRelic: $('customRelic').checked,
      relicLevel: Number($('relicLevel').value) || 0,
      customAbilities: $('customAbilities').checked,
      activeIds: activeIds,
      customPassives: $('customPassives').checked,
      passiveIds: passiveIds,
      customTalents: $('customTalents').checked,
      talentSelections: talentSelections,
      customEquipment: $('customEquipment').checked,
      equipment: equipment,
      customConsumables: $('customConsumables').checked,
      consumables: consumables
    };
  }

  function metric(label, value) {
    return '<div class="metric"><div class="label">' + label + '</div><div class="value">' + value + '</div></div>';
  }

  function renderRun(result) {
    const s = result.summary;
    $('resultTitle').textContent = humanClass(result.report.config.classId) + ' · ' + result.report.config.locationName;
    $('resultBody').className = '';
    let html = '<div class="metric-grid">';
    html += metric('Победа маршрута', s.routeWinRate + '%');
    html += metric('Смерть', s.deathRate + '%');
    html += metric('Дошёл до босса', s.bossReachRate + '%');
    html += metric('Boss conversion', s.bossConversion + '%');
    html += metric('Боев пережито', s.avgCombatsSurvived);
    html += metric('Расходников', s.consumableUses);
    html += '</div>';

    if (s.strong) {
      html += '<div class="section"><h3>Strong-встречи</h3><div class="kv">';
      html += '<div class="k">Strong до босса</div><div>' + s.strong.strongFightsMean + ' в среднем</div>';
      html += '<div class="k">До босса без strong</div><div>' + s.strong.noStrongToBossRate + '%</div>';
      html += '<div class="k">Два strong подряд</div><div>' + s.strong.consecutiveStrongRate + '%</div>';
      html += '<div class="k">Смертность normal / strong</div><div>' + s.strong.ordinaryDeathRate + '% / ' + s.strong.strongDeathRate + '%</div>';
      html += '</div></div>';
    }

    const p = result.report.resolvedProfile || {};
    html += '<div class="section"><h3>Использованная сборка</h3><div class="kv">';
    html += '<div class="k">Профиль</div><div>' + result.report.config.profile + '</div>';
    html += '<div class="k">Активные</div><div>' + ((p.activeAbilityIds || []).map(abilityLabel).join(', ') || '—') + '</div>';
    html += '<div class="k">Пассивы</div><div>' + ((p.passiveIds || []).map(passiveLabel).join(', ') || '—') + '</div>';
    html += '<div class="k">Реликвия</div><div>' + (p.relic && (p.relic.name || p.relic.id) || '—') + ' L' + (p.relic && p.relic.level || 0) + '</div>';
    html += '</div></div>';

    $('resultBody').innerHTML = html;
    if (result.report.maps) {
      const note = document.createElement('p');
      note.textContent = (result.report.altars ? 'Алтари: посещено ' + result.report.altars.visited + ', принято ' + result.report.altars.accepted + ', пропущено ' + result.report.altars.skipped + '. ' : '') + 'Карты: ' + JSON.stringify(result.report.maps.templates) + '. ' + result.report.limitations + ' Нештатных завершений: ' + result.report.runs.abnormal;
      $('resultBody').appendChild(note);
    }
    lastExport = { md: result.markdown, json: JSON.stringify(result.report, null, 2), prefix: 'ashen-balance-report' };
    $('exportButtons').classList.remove('hidden');
  }

  function renderFinder(result) {
    $('resultTitle').textContent = 'Top ' + result.config.topCount + ' билдов';
    $('resultBody').className = '';
    if (!result.builds.length) {
      $('resultBody').innerHTML = '<div class="error">Finder не нашёл валидных кандидатов с текущими ограничениями.</div>';
      return;
    }
    let html = '<table><thead><tr><th>#</th><th>Winrate</th><th>Δ к #1</th><th>Boss reach</th><th>Conversion</th><th>Death</th><th>95% CI</th><th>Δ к исходной</th><th>Расходников/поход</th></tr></thead><tbody>';
    result.builds.forEach(function(row) {
      html += '<tr><td>' + row.rank + '</td><td>' + row.winRate + '%</td><td>' + row.deltaFromTop + ' п.п.</td><td>' +
        row.bossReachRate + '%</td><td>' + row.bossConversion + '%</td><td>' + row.deathRate + '%</td><td>' +
        row.confidence95.low + '–' + row.confidence95.high + '%</td><td>' + row.deltaFromBaseline + ' п.п.</td><td>' + row.consumablesPerRun + '</td></tr>';
    });
    html += '</tbody></table><p>Проверок кандидатов: ' + result.diagnostics.evaluations + '; отклонено: ' + result.diagnostics.rejected + '. Подробности — в экспортируемом отчёте.</p><p>Исходная сборка: ' + result.config.baselineWinRate + '%. Отбор / проверка: seed ' + result.config.seed + ' / ' + result.config.validationSeed + '. Разница процентов сама по себе не доказывает превосходство.</p>';

    result.builds.forEach(function(row) {
      const gear = Object.entries(row.build.equipment || {}).map(function(entry) { return entry[0] + ': ' + entry[1]; }).join('; ');
      html += '<div class="build-card"><h3>#' + row.rank + ' · ' + row.winRate + '%</h3>' +
        '<p><b>Экипировка:</b> ' + (gear || 'по профилю') + '</p>' +
        '<p><b>Активные:</b> ' + ((row.build.activeIds || []).map(abilityLabel).join(', ') || 'по профилю') + '</p>' +
        '<p><b>Пассивы:</b> ' + ((row.build.passiveIds || []).map(passiveLabel).join(', ') || 'по профилю') + '</p>' +
        '<p><b>Таланты:</b> ' + (Object.values(row.build.talentSelections || {}).map(talentLabel).join(', ') || 'нет/по профилю') + '</p></div>';
    });
    $('resultBody').innerHTML = html;
    if (result.config.limitations) {
      const note = document.createElement('p');
      note.textContent = 'Алтари: ' + result.config.scenario.altarPolicy + '; проклятия на входе: ' + JSON.stringify(result.config.scenario.initialCurses) + '. ' + result.config.limitations + ' Карта: ' + (result.config.scenario.templateId || 'случайная по seed') + '; ветка: ' + (result.config.scenario.sublocationSlot + 1);
      $('resultBody').appendChild(note);
    }
    lastExport = { md: result.markdown, json: JSON.stringify(result, null, 2), prefix: 'ashen-top-builds' };
    $('exportButtons').classList.remove('hidden');
  }

  async function runSimulation() {
    if (busy) return;
    const config = gatherConfig();
    if (config.customAbilities && config.activeIds.length > 4) {
      showError('Можно выбрать не больше 4 активных способностей.');
      return;
    }
    setBusy(true);
    $('progressBox').classList.remove('hidden');
    try {
      const result = await window.balanceLab.run(config);
      renderRun(result);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function runFinder() {
    if (busy) return;
    const config = gatherConfig();
    config.screeningRuns = Number($('screeningRuns').value) || 30;
    config.finalRuns = Number($('finalRuns').value) || 500;
    config.beamWidth = Number($('beamWidth').value) || 8;
    config.topCount = Number($('topCount').value);
    config.optimizeEquipment = $('optimizeEquipment').checked;
    config.optimizeAbilities = $('optimizeAbilities').checked;
    config.optimizePassives = $('optimizePassives').checked;
    config.optimizeTalents = $('optimizeTalents').checked;
    setBusy(true);
    $('progressBox').classList.remove('hidden');
    try {
      const result = await window.balanceLab.findBuilds(config);
      renderFinder(result);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  async function init() {
    try {
      catalog = await window.balanceLab.getCatalog();
      catalog.curses.forEach(curse => {
        option($('preferredCurseId'), curse.id, curse.label);
        const label = document.createElement('label');
        label.textContent = curse.label;
        const input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.max = '5'; input.step = '1'; input.value = '0'; input.id = 'curse-' + curse.id;
        input.addEventListener('change', () => $('mapPreview').replaceChildren());
        label.appendChild(input); $('initialCurses').appendChild(label);
      });
      catalog.classes.forEach(function(entry) { option($('classId'), entry.id, entry.label); });
      catalog.locations.forEach(function(entry) { option($('location'), entry.id, entry.label); });
      catalog.profiles.forEach(function(entry) { option($('profile'), entry.id, entry.label); });
      catalog.policies.route.forEach(function(value) { option($('routePolicy'), value, value); });
      catalog.policies.combat.forEach(function(value) { option($('combatPolicy'), value, value); });
      catalog.policies.combat.forEach(function(value) { option($('bossPolicy'), value, value); });
      $('routePolicy').value = 'balanced';
      $('routeModel').addEventListener('change', updateLocations);
      $('location').addEventListener('change', updateMaps);
      $('templateId').addEventListener('change', () => $('mapPreview').replaceChildren());
      $('seed').addEventListener('change', () => $('mapPreview').replaceChildren());
      $('previewButton').addEventListener('click', previewMap);
      updateLocations();
      $('combatPolicy').value = 'competent';
      $('bossPolicy').value = 'boss_aware';
      $('profile').value = 'fresh';

      $('classId').addEventListener('change', renderPreset);
      $('profile').addEventListener('change', renderPreset);
      bindToggle('customRelic', 'relicLevel');
      bindToggle('customAbilities', 'abilities');
      bindToggle('customPassives', 'passives');
      bindToggle('customTalents', 'talents');
      bindToggle('customEquipment', 'equipment');
      bindToggle('customConsumables', 'consumables');

      $('runButton').addEventListener('click', runSimulation);
      $('finderButton').addEventListener('click', runFinder);
      $('cancelButton').addEventListener('click', async function() {
        await window.balanceLab.cancel();
        setBusy(false);
        $('status').textContent = 'Остановлено';
      });

      $('copyMd').addEventListener('click', async function() {
        if (!lastExport) return;
        await window.balanceLab.copy(lastExport.md);
        $('status').textContent = 'Отчёт скопирован';
      });
      $('exportMd').addEventListener('click', function() {
        if (!lastExport) return;
        window.balanceLab.save({ suggestedName: lastExport.prefix + '.md', content: lastExport.md });
      });
      $('exportJson').addEventListener('click', function() {
        if (!lastExport) return;
        window.balanceLab.save({ suggestedName: lastExport.prefix + '.json', content: lastExport.json });
      });

      window.balanceLab.onProgress(function(data) {
        $('progressBox').classList.remove('hidden');
        $('progressText').textContent = data.text || 'Выполняется…';
        const total = Number(data.total) || 0;
        const current = Number(data.current) || 0;
        $('progressNumbers').textContent = total ? current + ' / ' + total : '';
        $('progressBar').style.width = total ? Math.min(100, current / total * 100) + '%' : '12%';
      });

      renderPreset();
      $('status').textContent = 'Готово к запуску';
    } catch (error) {
      showError(error);
      $('status').textContent = 'Ошибка загрузки';
    }
  }

  init();
})();
