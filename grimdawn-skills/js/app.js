/* app.js - renders the card wall and drives the search box. */
(function () {
  'use strict';

  var F = window.GDFormat;
  var DATA = window.GD_SKILLS;

  var listEl = document.getElementById('skill-list');
  var searchEl = document.getElementById('input-search');
  var searchBlock = document.getElementById('input-block');
  var clearEl = document.getElementById('search-clear');
  var classSelector = document.getElementById('class-selector');
  var rankModeEl = document.getElementById('rank-mode');
  var charLevelEl = document.getElementById('char-level');

  // A buff in the game's sense is one it keeps running for you - the skills
  // whose tooltip ends in "Buffs are automatically activated". Those are the
  // toggled self buffs and auras, plus the two retaliation procs that reserve
  // energy the same way (Counter Strike, Vindictive Flame).
  //
  // The record class alone does not say it: Overguard, Blade Barrier,
  // Devastation and Blood of Dreeg are all Skill_Buff* and all still want a
  // button press.
  function isAutoBuff(skill) {
    var stats = skill.stats || {};
    if (/Toggled$/.test(stats.Class || '')) return true;
    return F.arr(stats.characterManaLimitReserve)[0] > 0;
  }

  // What a card calls itself. Anything hanging off another skill is a Modifier
  // (or a Transmuter); a root says whether it is a buff you leave running, and
  // whether only one such buff can be active at a time.
  function kindLabel(skill) {
    if (skill.kind === 'transmuter') return 'Transmuter';
    if (skill.parent) return 'Modifier';
    if (skill.kind === 'exclusive') return 'Exclusive Buff';
    if (isAutoBuff(skill)) return 'Buff';
    return 'Skill';
  }

  // "Werewolf and Wereraven", "Stun Jacks, Grenado, and Canister Bomb"
  function joinNames(names) {
    if (names.length < 2) return names.join('');
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
  }

  // Every skill this one hangs off, not just the one the tree parented it to.
  function referencedSkills(skill, cls) {
    var ids = F.arr(skill.depends);
    if (!ids.length && skill.parent) ids = [skill.parent];
    return ids.map(function (id) { return cls.nameById[id]; }).filter(Boolean);
  }

  var rankMode = '1';                 // '1' | 'max' | 'ult'
  var charLevel = 100;                // pet health/energy scale off this
  var hiddenClasses = Object.create(null);
  var cards = [];                     // {el, skill, cls, rank, paramsEl, rankEl, haystack}

  // ------------------------------------------------------------- helpers --

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function defaultRank(skill) {
    if (rankMode === 'max') return skill.maxLevel || 1;
    if (rankMode === 'ult') return skill.ultLevel || skill.maxLevel || 1;
    return 1;
  }

  // ---------------------------------------------------------------- card --

  function buildCard(skill, cls) {
    var card = el('div', 'skill-card is-' + skill.kind);

    var head = el('div', 'skill-card-head');
    var bmp = el('div', 'skill-bitmap-container');
    if (skill.icon) {
      var img = el('img', 'skill-bitmap');
      img.src = 'icons/' + skill.icon;
      img.alt = '';
      bmp.appendChild(img);
    }
    head.appendChild(bmp);

    var text = el('div', 'skill-head-text');
    text.appendChild(el('div', 'skill-name', F.esc(skill.name)));

    var label = kindLabel(skill);
    var subtitle = F.esc(cls.name) + ' ' + label;
    var affects = referencedSkills(skill, cls);
    if (affects.length) {
      subtitle += ' for ' + joinNames(affects.map(function (n) {
        return '<span class="skill-ref">' + F.esc(n) + '</span>';
      }));
    }
    text.appendChild(el('div', 'skill-subtitle', subtitle));

    text.appendChild(el('div', 'skill-req',
      'Requires: ' + F.esc(cls.name) + ' Mastery Level ' + skill.levelReq));
    head.appendChild(text);
    card.appendChild(head);

    // rank stepper
    var ult = skill.ultLevel || skill.maxLevel || 1;
    var rank = Math.min(defaultRank(skill), ult);

    var rankRow = el('div', 'skill-rank');
    var dec = el('button', 'rank-btn', '&minus;');
    var value = el('span', 'rank-value');
    var inc = el('button', 'rank-btn', '+');
    var slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'rank-slider';
    slider.min = 1;
    slider.max = ult;
    slider.value = rank;
    // A one-rank skill has nothing to drag between, so it just states its rank.
    if (ult > 1) {
      rankRow.appendChild(dec);
      rankRow.appendChild(value);
      rankRow.appendChild(inc);
      rankRow.appendChild(slider);
    } else {
      rankRow.classList.add('fixed');
      rankRow.appendChild(value);
    }
    card.appendChild(rankRow);

    var params = el('div', 'tooltip-skill-params');
    card.appendChild(params);

    var petEl = null;
    if (skill.pets || skill.petBonus || skill.granted) {
      petEl = el('div', 'tooltip-pet-params');
      card.appendChild(petEl);
    }
    if (skill.desc) {
      card.appendChild(el('div', 'skill-description-text', F.renderDesc(skill.desc)));
    }

    var entry = {
      el: card, skill: skill, cls: cls, rank: rank,
      params: params, petEl: petEl, value: value, slider: slider,
      dec: dec, inc: inc, ult: ult
    };

    function setRank(r) {
      entry.rank = Math.max(1, Math.min(ult, r));
      slider.value = entry.rank;
      paint(entry);
    }
    dec.addEventListener('click', function () { setRank(entry.rank - 1); });
    inc.addEventListener('click', function () { setRank(entry.rank + 1); });
    slider.addEventListener('input', function () { setRank(+slider.value); });
    entry.setRank = setRank;

    paint(entry);

    // Search matches whatever the card can ever show, not just the current
    // rank, so typing "bleeding" still finds a skill that only bleeds at 5.
    entry.haystack = (skill.name + ' ' + cls.name + ' ' + (skill.desc || '') + ' ' +
      kindLabel(skill) + ' ' + referencedSkills(skill, cls).join(' ') + ' ' +
      F.stripTags(lineHtml(skill, 1)) + ' ' +
      F.stripTags(lineHtml(skill, ult))).toLowerCase();

    return entry;
  }

  function lineHtml(skill, rank) {
    var lines = F.skillLines(skill, rank);
    var out = '';
    for (var i = 0; i < lines.length; i++) out += lines[i].html + ' ';
    F.petBonusLines(skill, rank).forEach(function (l) { out += l.html + ' '; });
    F.grantedSkills(skill, rank).forEach(function (ab) {
      out += ab.name + ' ';
      ab.lines.forEach(function (l) { out += l.html + ' '; });
    });
    F.petBlocks(skill, rank, 100).forEach(function (pet) {
      out += pet.name + ' ';
      pet.attrs.forEach(function (l) { out += l.html + ' '; });
      pet.abilities.forEach(function (ab) {
        out += ab.name + ' ';
        ab.lines.forEach(function (l) { out += l.html + ' '; });
      });
    });
    return out;
  }

  function rows(lines, extraCls) {
    var html = '';
    for (var i = 0; i < lines.length; i++) {
      html += '<div class="stat-row ' + (extraCls || '') + ' ' + lines[i].cls + '">' +
              lines[i].html + '</div>';
    }
    return html;
  }

  function abilityRows(list) {
    var html = '';
    list.forEach(function (ab) {
      html += '<div class="pet-ability">';
      if (ab.icon) html += '<img class="pet-ability-icon" src="icons/' + ab.icon + '" alt="">';
      html += '<span>' + F.esc(ab.name) + '</span></div>';
      html += rows(ab.lines, 'indent2');
    });
    return html;
  }

  function petHtml(skill, rank) {
    var html = '';

    var granted = F.grantedSkills(skill, rank);
    if (granted.length) {
      html += '<div class="pet-heading">' + F.render('tagTooltipSkillsHeader', []) + '</div>';
      html += abilityRows(granted);
    }

    var bonus = F.petBonusLines(skill, rank);
    if (bonus.length) {
      html += '<div class="pet-heading">' + F.render('tagPetBonusNameAllPets', []) + '</div>';
      html += rows(bonus, 'indent');
    }

    F.petBlocks(skill, rank, charLevel).forEach(function (pet) {
      if (pet.chance) {
        html += '<div class="pet-variant">' + pet.chance + '% chance:</div>';
      }
      if (pet.attrs.length) {
        html += '<div class="pet-heading">' + F.render('SkillPetDescriptionHeading', [pet.name]) + '</div>';
        html += rows(pet.attrs, 'indent');
      }
      if (pet.abilities.length) {
        html += '<div class="pet-heading">' + F.render('tagSkillPetAbilities', [pet.name]) + '</div>';
        html += abilityRows(pet.abilities);
      }
    });
    return html;
  }

  function paint(entry) {
    entry.params.innerHTML = rows(F.skillLines(entry.skill, entry.rank));
    if (entry.petEl) entry.petEl.innerHTML = petHtml(entry.skill, entry.rank);

    var cap = entry.skill.maxLevel || entry.ult;
    var over = entry.rank > cap;
    entry.value.innerHTML = (over ? '<span class="over-cap">' + entry.rank + '</span>' : entry.rank) +
      ' / ' + cap;
    entry.dec.disabled = entry.rank <= 1;
    entry.inc.disabled = entry.rank >= entry.ult;
  }

  // --------------------------------------------------------------- render --

  function render() {
    listEl.innerHTML = '';
    cards = [];

    DATA.classes.forEach(function (cls) {
      // so a modifier can name the skill it hangs off
      cls.nameById = Object.create(null);
      cls.skills.forEach(function (s) { cls.nameById[s.id] = s.name; });

      var header = el('div', 'skill-list-group-header');
      header.dataset.cls = cls.id;
      header.appendChild(el('span', 'title', F.esc(cls.name)));
      header.appendChild(el('span', 'count', cls.skills.length + ' skills'));
      listEl.appendChild(header);

      var group = el('div', 'skill-list-group');
      group.dataset.cls = cls.id;
      cls.skills.forEach(function (skill) {
        var entry = buildCard(skill, cls);
        group.appendChild(entry.el);
        cards.push(entry);
      });
      listEl.appendChild(group);
    });

    var empty = el('div', 'no-results', 'No skills match that search.');
    empty.style.display = 'none';
    empty.id = 'no-results';
    listEl.appendChild(empty);
  }

  // --------------------------------------------------------------- search --

  // Space separated terms, all of which must match. "quoted phrases" stay
  // together and a leading - excludes, the way the item database behaves.
  function parseQuery(q) {
    var terms = [];
    var re = /-?"([^"]*)"|(\S+)/g;
    var m;
    while ((m = re.exec(q)) !== null) {
      var raw = m[0];
      var neg = raw.charAt(0) === '-';
      var text = (m[1] !== undefined ? m[1] : m[2]);
      if (neg) text = text.replace(/^-/, '').replace(/^"|"$/g, '');
      text = text.toLowerCase().trim();
      if (text) terms.push({ text: text, neg: neg });
    }
    return terms;
  }

  function syncUrl() {
    var q = searchEl.value.trim();
    var parts = [];
    if (q) parts.push('q=' + encodeURIComponent(q));
    var shown = DATA.classes.filter(function (c) { return !hiddenClasses[c.id]; });
    if (shown.length !== DATA.classes.length) {
      parts.push('cls=' + shown.map(function (c) { return c.index; }).join(','));
    }
    if (rankMode !== '1') parts.push('rank=' + rankMode);
    if (charLevel !== 100) parts.push('lv=' + charLevel);
    var url = location.pathname + (parts.length ? '?' + parts.join('&') : '');
    try { history.replaceState(null, '', url); } catch (e) { /* file:// */ }
  }

  function applyFilter() {
    var q = searchEl.value.trim();
    searchBlock.classList.toggle('has-text', q.length > 0);
    var terms = parseQuery(q);

    var visibleByClass = Object.create(null);
    cards.forEach(function (entry) {
      var show = !hiddenClasses[entry.cls.id];
      if (show) {
        for (var i = 0; i < terms.length; i++) {
          var hit = entry.haystack.indexOf(terms[i].text) !== -1;
          if (terms[i].neg ? hit : !hit) { show = false; break; }
        }
      }
      entry.el.style.display = show ? '' : 'none';
      if (show) visibleByClass[entry.cls.id] = (visibleByClass[entry.cls.id] || 0) + 1;
    });

    var total = 0;
    DATA.classes.forEach(function (cls) {
      var n = visibleByClass[cls.id] || 0;
      total += n;
      var header = listEl.querySelector('.skill-list-group-header[data-cls="' + cls.id + '"]');
      var group = listEl.querySelector('.skill-list-group[data-cls="' + cls.id + '"]');
      header.style.display = n ? '' : 'none';
      group.style.display = n ? '' : 'none';
      header.querySelector('.count').textContent =
        n === cls.skills.length ? n + ' skills' : n + ' of ' + cls.skills.length + ' skills';
    });

    document.getElementById('no-results').style.display = total ? 'none' : '';
  }

  // ----------------------------------------------------------- selectors --

  function buildClassSelector() {
    var tabs = [];

    function syncTabs() {
      tabs.forEach(function (t) {
        t.classList.toggle('selected', !hiddenClasses[t.dataset.cls]);
      });
    }

    DATA.classes.forEach(function (cls) {
      var tab = el('div', 'tab selected', F.esc(cls.name));
      tab.dataset.cls = cls.id;
      tab.addEventListener('click', function () {
        var shown = DATA.classes.filter(function (c) { return !hiddenClasses[c.id]; });
        var isOnly = shown.length === 1 && shown[0].id === cls.id;

        if (shown.length === DATA.classes.length) {
          // Nothing is filtered yet, so the first click means "just this one"
          // rather than "all except this one".
          DATA.classes.forEach(function (c) { hiddenClasses[c.id] = c.id !== cls.id; });
        } else if (isOnly) {
          // Clicking the last one standing goes back to everything, so the
          // isolate step is always one click from undone.
          DATA.classes.forEach(function (c) { hiddenClasses[c.id] = false; });
        } else {
          hiddenClasses[cls.id] = !hiddenClasses[cls.id];
        }
        syncTabs();
        applyFilter();
        syncUrl();
      });
      tabs.push(tab);
      classSelector.appendChild(tab);
    });

    return syncTabs;
  }

  function selectRankMode(mode) {
    rankMode = mode;
    Array.prototype.forEach.call(rankModeEl.children, function (t) {
      t.classList.toggle('selected', t.dataset.mode === mode);
    });
    cards.forEach(function (entry) { entry.setRank(defaultRank(entry.skill)); });
  }

  function bindRankMode() {
    rankModeEl.addEventListener('click', function (e) {
      var tab = e.target.closest('.tab');
      if (!tab) return;
      selectRankMode(tab.dataset.mode);
      syncUrl();
    });
  }

  function bindCharLevel() {
    charLevelEl.addEventListener('input', function () {
      var v = parseInt(charLevelEl.value, 10);
      if (!v || v < 1) return;                 // mid-edit, leave the cards alone
      charLevel = Math.min(v, 110);
      cards.forEach(function (entry) {
        if (entry.petEl) entry.petEl.innerHTML = petHtml(entry.skill, entry.rank);
      });
      syncUrl();
    });
  }

  // ------------------------------------------------------------------ go --

  if (!DATA || !DATA.classes) {
    listEl.innerHTML = '<div class="no-results">Skill data failed to load. ' +
      'Run <code>tools\\build.ps1</code> first.</div>';
    return;
  }

  var syncClassTabs = buildClassSelector();
  bindRankMode();
  bindCharLevel();

  var initialCls = /[?&]cls=([\d,]+)/.exec(location.search);
  if (initialCls) {
    var wanted = initialCls[1].split(',');
    DATA.classes.forEach(function (c) {
      hiddenClasses[c.id] = wanted.indexOf(String(c.index)) === -1;
    });
    syncClassTabs();
  }

  var initialLevel = /[?&]lv=(\d+)/.exec(location.search);
  if (initialLevel) {
    charLevel = Math.max(1, Math.min(110, parseInt(initialLevel[1], 10)));
    charLevelEl.value = charLevel;
  }
  var initialRank = /[?&]rank=(1|max|ult)/.exec(location.search);
  if (initialRank) rankMode = initialRank[1];
  render();
  if (initialRank) selectRankMode(rankMode);

  var initial = /[?&]q=([^&]*)/.exec(location.search);
  if (initial) searchEl.value = decodeURIComponent(initial[1].replace(/\+/g, ' '));
  applyFilter();

  var timer = null;
  searchEl.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { applyFilter(); syncUrl(); }, 90);
  });
  clearEl.addEventListener('click', function () {
    searchEl.value = '';
    applyFilter();
    syncUrl();
    searchEl.focus();
  });
  searchEl.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { searchEl.value = ''; applyFilter(); syncUrl(); }
  });

  // "/" focuses the search box, as on the item database
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== searchEl) {
      e.preventDefault();
      searchEl.focus();
    }
  });
})();
