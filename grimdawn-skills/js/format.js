/* format.js - turns a skill's raw dbr fields into tooltip lines.
 *
 * Grim Dawn keeps the wording of every stat line in its text tags, as printf
 * style templates: "DamageFire={%t0} {^E}Fire Damage". We ship those strings
 * verbatim and fill them here, so the output reads like the in-game skill
 * window rather than like something reworded by hand.
 */
window.GDFormat = (function () {
  'use strict';

  var S = window.GD_STRINGS || {};

  function tpl(key) {
    if (Object.prototype.hasOwnProperty.call(S, key)) return S[key];
    // a handful of lines the game builds in code, see LITERAL below
    if (Object.prototype.hasOwnProperty.call(LITERAL, key)) return LITERAL[key];
    return null;
  }

  // -- text rendering -------------------------------------------------------

  // {^E} and friends switch colour part way through a line.
  var COLORS = {
    E: 'c-e', H: 'c-h', S: 'c-s', Z: 'c-z',
    w: 'c-w', y: 'c-y', g: 'c-g', r: 'c-r', b: 'c-b', o: 'c-o', v: 'c-v', p: 'c-v',
    k: 'c-k'
  };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fixed(n, dec) {
    var out = n.toFixed(dec);
    // 3.0 -> 3, but 3.5 stays 3.5; the game does the same for whole numbers.
    if (dec > 0 && /\.0+$/.test(out)) out = out.replace(/\.0+$/, '');
    return out;
  }

  function substitute(text, args) {
    var out = text.replace(/%([+\-]?)([0-9.]*)([fdstgz])([0-9])/g,
      function (m, sign, prec, type, idx) {
        var v = args[+idx];
        if (v === undefined || v === null) return '';
        if (type === 's' || type === 't') return String(v);
        var n = Number(v);
        if (isNaN(n)) return String(v);
        var dec = 0;
        var dot = prec.indexOf('.');
        if (dot >= 0) dec = parseInt(prec.slice(dot + 1), 10) || 0;
        if (type === 'd') dec = 0;
        var s = fixed(n, dec);
        if (sign === '+' && n >= 0) s = '+' + s;
        return s;
      });
    return out.replace(/[{}]/g, '');
  }

  // Renders one template string into HTML. Missing templates fall back to the
  // key itself so a gap is visible rather than silently dropped.
  //
  // `state` carries the current colour across templates. The game builds a line
  // like "25% Chance of 34 Lightning Damage" by concatenating two strings, and
  // the first ends on {^H} so that the second one's leading number comes out
  // white - which only works if the colour survives the join.
  function render(key, args, state) {
    var t = tpl(key);
    if (t === null) return '<span class="c-missing">' + esc(key) + '</span>';
    return renderRaw(t, args || [], state);
  }

  function renderRaw(t, args, state) {
    var st = state || { color: null };
    var html = '';
    var parts = t.split(/(\{\^[^}]{0,4}\})/);
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part) continue;
      var m = /^\{\^([^}]*)\}$/.exec(part);
      if (m) {
        var code = m[1];
        if (code === 'n') { html += '<br>'; continue; }
        st.color = COLORS[code] || null;
        continue;
      }
      var text = substitute(part, args);
      if (!text) continue;
      html += st.color ? '<span class="' + st.color + '">' + esc(text) + '</span>' : esc(text);
    }
    return html;
  }

  // Concatenates templates while keeping the colour state, for lines the game
  // assembles from several pieces. Each item is [key, args] or a literal string.
  function renderJoin(pieces) {
    var st = { color: null };
    var html = '';
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      if (p === null || p === undefined || p === '') continue;
      if (typeof p === 'string') {
        html += st.color ? '<span class="' + st.color + '">' + esc(p) + '</span>' : esc(p);
      } else {
        html += render(p[0], p[1] || [], st);
      }
    }
    return html;
  }

  // -- value access ---------------------------------------------------------

  // Set by qa.html to find fields no renderer looks at.
  var trace = null;

  // Every numeric field is either a scalar or one entry per skill rank.
  function at(stats, key, rank) {
    if (trace) trace[key] = true;
    var v = stats[key];
    if (v === undefined || v === null) return undefined;
    if (Array.isArray(v)) {
      if (!v.length) return undefined;
      return v[Math.min(rank, v.length) - 1];
    }
    return v;
  }

  function has(stats, key, rank) {
    var v = at(stats, key, rank);
    return v !== undefined && v !== 0;
  }

  // PowerShell's ConvertTo-Json writes a one-element array as a bare object, so
  // anything variable-length coming out of the build gets normalised here.
  function arr(v) {
    if (v === undefined || v === null) return [];
    return Array.isArray(v) ? v : [v];
  }

  function amount(min, max) {
    if (max === undefined || max === null || max <= min) return fixed(min, 0);
    return fixed(min, 0) + '-' + fixed(max, 0);
  }

  // "over 3 Seconds" / "for 3 Seconds" suffixes
  function overTime(secs) {
    if (!secs) return null;
    return [secs === 1 ? 'DamageSingleFormatSecond' : 'DamageSingleFormatTime', [secs]];
  }
  function forTime(secs) {
    if (!secs) return null;
    return [secs === 1 ? 'DamageFixedSingleFormatSecond' : 'DamageFixedSingleFormatTime', [secs]];
  }
  function chanceOf(pct) {
    if (!pct) return null;
    return ['tagChanceOf', [pct]];
  }

  // -- tables ---------------------------------------------------------------

  var FLAT_DAMAGE = ['Physical', 'Pierce', 'Fire', 'Cold', 'Lightning', 'Poison',
                     'Life', 'Aether', 'Chaos', 'Elemental'];

  // damage-over-time: an amount plus a duration
  var DOT_DAMAGE = ['Physical', 'Bleeding', 'Fire', 'Cold', 'Lightning', 'Poison',
                    'Life', 'Elemental', 'LifeLeach', 'ManaLeach'];

  // timed debuffs that are not damage
  var DOT_DEBUFF = ['AttackSpeed', 'SpellCastSpeed', 'RunSpeed', 'TotalSpeed',
                    'OffensiveAbility', 'DefensiveAbility',
                    'OffensiveReduction', 'DefensiveReduction', 'DamageMult'];

  // instant "reduced target's X" effects
  var REDUCTIONS = [
    ['TotalDamageReductionPercent', 'DamageTotalDamageReductionPercent'],
    ['TotalDamageReductionAbsolute', 'DamageTotalDamageReductionAbsolute'],
    ['PhysicalReductionPercent', 'DamagePhysicalReductionPercent'],
    ['ElementalReductionPercent', 'DamageElementalReductionPercent'],
    ['TotalResistanceReductionPercent', 'DamageTotalResistanceReductionPercent'],
    ['TotalResistanceReductionAbsolute', 'DamageTotalResistanceReductionAbsolute'],
    ['PhysicalResistanceReductionPercent', 'DamagePhysicalResistanceReductionPercent'],
    ['PhysicalResistanceReductionAbsolute', 'DamagePhysicalResistanceReductionAbsolute'],
    ['ElementalResistanceReductionPercent', 'DamageElementalResistanceReductionPercent'],
    ['ElementalResistanceReductionAbsolute', 'DamageElementalResistanceReductionAbsolute'],
    ['Fumble', 'DamageDurationFumble'],
    ['ProjectileFumble', 'DamageDurationProjectileFumble']
  ];

  // crowd control: a duration, usually with a chance in front
  var CONTROL = ['Stun', 'Freeze', 'Petrify', 'Trap', 'Knockdown', 'Convert',
                 'Fear', 'Confusion', 'Disruption', 'Sleep'];

  var DAMAGE_MODIFIERS = ['Physical', 'Pierce', 'PierceRatio', 'Fire', 'Cold', 'Lightning',
                          'Poison', 'Life', 'Aether', 'Chaos', 'Elemental', 'Stun',
                          'Knockdown', 'Trap', 'Freeze', 'Petrify'];

  var DOT_MODIFIERS = ['Physical', 'Bleeding', 'Fire', 'Cold', 'Lightning', 'Poison',
                       'Life', 'LifeLeach', 'ManaLeach', 'AttackSpeed', 'SpellCastSpeed',
                       'RunSpeed', 'OffensiveAbility', 'DefensiveAbility',
                       'OffensiveReduction', 'DamageMult'];

  var RETALIATION = ['Physical', 'Pierce', 'Fire', 'Cold', 'Lightning', 'Poison',
                     'Life', 'Aether', 'Chaos', 'Elemental', 'Stun'];

  // character bonuses, in the order the game lists them
  var CHARACTER = [
    ['characterStrength', 'tagCharAttribute02'],
    ['characterDexterity', 'tagCharAttribute01'],
    ['characterIntelligence', 'tagCharAttribute03'],
    ['characterStrengthModifier', 'tagCharAttribute02Modifier'],
    ['characterDexterityModifier', 'tagCharAttribute01Modifier'],
    ['characterIntelligenceModifier', 'tagCharAttribute03Modifier'],
    ['characterLife', 'tagCharAttribute04'],
    ['characterLifeModifier', 'tagCharAttribute04Modifier'],
    ['characterMana', 'tagCharAttribute05'],
    ['characterManaModifier', 'tagCharAttribute05Modifier'],
    ['characterConstitutionModifier', 'tagCharConstitutionModifier'],
    ['characterLifeRegen', 'tagCharLifeRegen'],
    ['characterLifeRegenModifier', 'tagCharLifeRegenModifier'],
    ['characterManaRegen', 'tagCharManaRegen'],
    ['characterManaRegenModifier', 'tagCharManaRegenModifier'],
    ['characterOffensiveAbility', 'tagCharOffensiveAbility'],
    ['characterOffensiveAbilityModifier', 'tagCharOffensiveAbilityModifier'],
    ['characterDefensiveAbility', 'tagCharDefensiveAbility'],
    ['characterDefensiveAbilityModifier', 'tagCharDefensiveAbilityModifier'],
    ['characterAttackSpeedModifier', 'tagCharAttackSpeedModifier'],
    ['characterSpellCastSpeedModifier', 'tagCharSpellCastSpeedModifier'],
    ['characterRunSpeedModifier', 'tagCharRunSpeedModifier'],
    ['characterTotalSpeedModifier', 'tagCharTotalSpeedModifier'],
    ['characterAttackSpeedMaxModifier', 'tagCharAttackSpeedMaxModifier'],
    ['characterSpellCastSpeedMaxModifier', 'tagCharSpellCastSpeedMaxModifier'],
    ['characterRunSpeedMaxModifier', 'tagCharRunSpeedMaxModifier'],
    ['characterDodgePercent', 'tagCharDodgePercent'],
    ['characterDeflectProjectile', 'tagCharDeflectProjectiles'],
    ['characterEnergyAbsorptionPercent', 'tagCharEnergyAbsorptionPercent'],
    ['characterHealIncreasePercent', 'tagCharPercentHealIncreaseModifier'],
    ['characterDefensiveBlockRecoveryReduction', 'tagCharDefensiveBlockRecoveryReduction'],
    ['characterArmorStrengthReqReduction', 'tagCharArmorStrengthReqReduction'],
    ['characterManaLimitReserveReduction', 'tagCharManaLimitReserveReduction']
  ];

  var DEFENSIVE = [
    ['defensiveProtection', 'DefenseAbsorptionProtectionPlus'],
    ['defensiveProtectionModifier', 'DefenseProtectionModifier'],
    ['defensiveAbsorptionModifier', 'DefenseAbsorptionModifier'],
    ['defensiveBlockModifier', 'DefenseBlockModifier'],
    ['defensiveBlockAmountModifier', 'DefenseBlockAmountModifier'],
    ['defensivePhysical', 'DefensePhysical'],
    ['defensivePierce', 'DefensePierce'],
    ['defensiveElementalResistance', 'DefenseElementalResistance'],
    ['defensiveFire', 'DefenseFire'],
    ['defensiveCold', 'DefenseCold'],
    ['defensiveLightning', 'DefenseLightning'],
    ['defensivePoison', 'DefensePoison'],
    ['defensiveLife', 'DefenseLife'],
    ['defensiveAether', 'DefenseAether'],
    ['defensiveChaos', 'DefenseChaos'],
    ['defensiveBleeding', 'DefenseBleeding'],
    ['defensiveLifeLeach', 'DefenseLifeLeach'],
    ['defensiveSlowLifeLeach', 'DefenseLifeLeach'],
    ['defensiveSlowManaLeach', 'DefenseManaLeach'],
    ['defensiveAllMaxResist', 'DefenseAllMaxResist'],
    ['defensiveStun', 'DefenseStun'],
    ['defensiveFreeze', 'DefenseFreeze'],
    ['defensiveTrap', 'DefenseTrap'],
    ['defensivePetrify', 'DefensePetrify'],
    ['defensiveConvert', 'DefenseConvert'],
    ['defensiveFear', 'DefenseFear'],
    ['defensiveConfusion', 'DefenseConfusion'],
    ['defensiveTaunt', 'DefenseTaunt'],
    ['defensiveDisruption', 'DefenseDisruption'],
    ['defensiveCrowdControl', 'DefenseCrowdControl'],
    ['defensiveCrowdControlMaxResist', 'DefenseCrowdControlMaxResist'],
    ['defensiveReflect', 'DefenseReflect'],
    ['defensivePercentReflectionResistance', 'DefenseReflectResist'],
    ['defensivePercentCurrentLife', 'DefensePercentCurrentLife'],
    ['defensiveFireDuration', 'DefenseFireDuration'],
    ['defensivePoisonDuration', 'DefensePoisonDuration'],
    ['defensiveBleedingDuration', 'DefenseBleedingDuration']
  ];

  // A few fields the game formats in code rather than through a text tag.
  var LITERAL = {
    defensiveTotalSpeedResistance: '{%.0f0}% {^E}Slow Resistance',
    retaliationDamagePct: '{%.0f0}% {^E}of Retaliation Damage added to Attack',
    contagionRadius: '{%.1f0} {^E}Meter Spread Radius',
    contagionMaxSpread: '{^E}Spreads to {^H}{%d0} {^E}Enemies',
    DamageSleep: '{^E}Put target to Sleep{^H}{%t0}',
    skillChargeTime: '{%.2f0} {^E}Second Charge Time',
    skillChargeDuration: '{%.1f0} {^E}Second Charge Duration',
    waveDistance: '{%.1f0} {^E}Meter Wave Distance',
    refreshCooldown: '{%.0f0}% {^E}Chance to reduce {^Z}{%s1}{^E} Cooldown by {^H}{%.1f2} {^E}Seconds',
    refreshDuration: '{%.0f0}% {^E}Chance to extend {^Z}{%s1}{^E} by {^H}{%.1f2} {^E}Second, up to {^H}{%.1f3} {^E}Seconds'
  };

  // ------------------------------------------------------------------------

  function Lines() { this.list = []; }
  Lines.prototype.push = function (html, cls, global) {
    if (html) this.list.push({ html: html, cls: cls || '', global: !!global });
  };
  Lines.prototype.tag = function (key, args, cls, global) {
    if (tpl(key) === null) return;
    this.push(render(key, args), cls, global);
  };

  /* Builds the stat block for one skill at one rank. */
  function skillLines(skill, rank) {
    var st = skill.stats || {};
    var L = new Lines();
    var v, min, max, dur, chance, i, k;

    function val(key) { return at(st, key, rank); }
    function on(key) { return has(st, key, rank); }

    // -- cost, timing, shape ------------------------------------------------
    if (on('skillManaCost')) {
      var costKey = /Channelled|Toggle/i.test(st.Class || '') ? 'ManaCostPerSecond' : 'ManaCost';
      L.tag('SkillCostFormat', [val('skillManaCost'), stripCodes(tpl(costKey))]);
    }
    if (on('characterManaLimitReserve')) L.tag('tagCharManaLimitReserve', [val('characterManaLimitReserve')]);
    var cd = on('skillCooldownTime') ? val('skillCooldownTime') : val('cooldownTime');
    if (cd) L.tag('SkillSecondFormat', [cd, stripCodes(tpl('CooldownTime'))]);
    if (on('cooldownCharges')) L.tag('CooldownCharges', [val('cooldownCharges')]);
    var dn = on('skillActiveDuration') ? val('skillActiveDuration') : val('duration');
    if (dn) L.tag('SkillSecondFormat', [dn, stripCodes(tpl('ActiveDuration'))]);
    if (on('skillTargetRadius')) L.tag('SkillDistanceFormat', [val('skillTargetRadius'), stripCodes(tpl('TargetRadius'))]);
    if (on('explosionRadius')) L.tag('SkillDistanceFormat', [val('explosionRadius'), stripCodes(tpl('ExplosionRadius'))]);
    if (on('projectileExplosionRadius')) L.tag('SkillDistanceFormat', [val('projectileExplosionRadius'), stripCodes(tpl('ExplosionRadius'))]);
    if (on('maxRange')) L.tag('SkillDistanceFormat', [val('maxRange'), stripCodes(tpl('TargetRange'))]);
    if (on('skillTargetAngle')) L.tag('TargetAngle', [val('skillTargetAngle')]);
    // a cap of one target or one projectile is the engine default, not a stat
    if (val('skillTargetNumber') > 1) L.tag('TargetNumber', [val('skillTargetNumber')]);
    if (val('skillProjectileNumber') > 1) L.tag('ProjectileLaunchNumber', [val('skillProjectileNumber')]);
    else if (val('projectileLaunchNumber') > 1) L.tag('ProjectileLaunchNumber', [val('projectileLaunchNumber')]);
    if (on('projectileFragmentsLaunchNumberMin')) {
      var fmin = val('projectileFragmentsLaunchNumberMin');
      var fmax = val('projectileFragmentsLaunchNumberMax');
      if (fmax > fmin) L.tag('ProjectileFragmentsLaunchNumberMinMax', [fmin, fmax]);
      else L.tag('ProjectileFragmentsLaunchNumber', [fmin]);
    }
    if (on('projectilePiercingChance')) L.tag('ProjectilePiercingChance', [val('projectilePiercingChance')]);
    if (on('petLimit')) L.tag('SkillPetLimit', [val('petLimit')]);
    if (on('petBurstSpawn')) L.tag('SkillPetBurstSpawn', [val('petBurstSpawn')]);
    if (on('spawnObjectsTimeToLive')) L.tag('tagSkillPetTimeToLive', [val('spawnObjectsTimeToLive')]);
    if (on('onHitActivationChance')) {
      L.tag('SkillPercentFormat', [val('onHitActivationChance'), stripCodes(tpl('SkillActivationChance'))]);
    }
    if (on('lifeMonitorPercent')) L.tag('LifeMonitorPercent', [val('lifeMonitorPercent')]);
    if (on('skillChanceWeight')) L.tag('SkillChanceWeight', [val('skillChanceWeight')]);
    if (on('damageAbsorption')) L.tag('SkillDamageAbsorption', [val('damageAbsorption')]);
    if (on('damageAbsorptionPercent')) L.tag('SkillDamageAbsorptionPercent', [val('damageAbsorptionPercent')]);
    if (on('skillLifeBonus')) L.tag('SkillLifeBonus', [val('skillLifeBonus')]);
    if (on('skillLifePercent')) L.tag('SkillLifePercent', [val('skillLifePercent')]);
    if (on('skillManaCostReduction')) L.tag('SkillManaCostReduction', [val('skillManaCostReduction')]);
    if (on('skillCooldownReduction')) L.tag('SkillCooldownReduction', [val('skillCooldownReduction')]);
    if (on('skillTargetInterval')) L.tag('SkillSecondFormat', [val('skillTargetInterval'), stripCodes(tpl('Interval'))]);

    // Charge skills list the damage multiplier at each charge level. The list
    // is indexed by charge level, not by rank; the rank says how many apply.
    if (st.skillChargeMultipliers) {
      var mults = [].concat(st.skillChargeMultipliers);
      var levels = Math.min(val('skillChargeLevel') || mults.length, mults.length);
      var pieces = [['SkillChargeMax']];
      for (i = 0; i < levels; i++) {
        pieces.push([i === 0 ? 'SkillChargeLevel' : 'SkillChargeLevel2', [mults[i]]]);
      }
      L.push(renderJoin(pieces));
    }

    // Berserker's transformation passives refresh another skill's cooldown.
    if (on('refreshCooldownChance') && st.refreshCooldownSkillName) {
      L.push(renderRaw(LITERAL.refreshCooldown,
        [val('refreshCooldownChance'), st.refreshCooldownSkillName, val('refreshCooldownAmount')]));
    }
    if (on('refreshDurationChance') && st.refreshDurationSkillName) {
      L.push(renderRaw(LITERAL.refreshDuration,
        [val('refreshDurationChance'), st.refreshDurationSkillName,
         val('refreshDurationAmount'), val('refreshDurationMax')]));
    }

    for (k in LITERAL) {
      if (!Object.prototype.hasOwnProperty.call(st, k)) continue;
      if (!on(k)) continue;
      if (k === 'defensiveTotalSpeedResistance' || k === 'retaliationDamagePct') continue; // placed later
      L.push(renderRaw(LITERAL[k], [val(k)]));
    }

    // -- weapon damage ------------------------------------------------------
    if (on('weaponDamagePct')) L.tag('SkillWeaponDamageFormat', [val('weaponDamagePct')]);

    // -- flat damage --------------------------------------------------------
    for (i = 0; i < FLAT_DAMAGE.length; i++) {
      k = FLAT_DAMAGE[i];
      min = val('offensive' + k + 'Min');
      if (!min) continue;
      max = val('offensive' + k + 'Max');
      chance = val('offensive' + k + 'Chance');
      L.push(renderJoin([chanceOf(chance), ['Damage' + k, [amount(min, max)]]]),
             '', val('offensive' + k + 'Global'));
    }
    if (on('offensiveLifeLeechMin')) {
      L.tag('DamageLifeLeech', [amount(val('offensiveLifeLeechMin'), val('offensiveLifeLeechMax'))]);
    }
    if (on('offensivePercentCurrentLifeMin')) {
      L.tag('DamagePercentCurrentLife', [amount(val('offensivePercentCurrentLifeMin'), val('offensivePercentCurrentLifeMax'))]);
    }

    // -- damage over time ---------------------------------------------------
    for (i = 0; i < DOT_DAMAGE.length; i++) {
      k = DOT_DAMAGE[i];
      min = val('offensiveSlow' + k + 'Min');
      if (!min) continue;
      max = val('offensiveSlow' + k + 'Max');
      dur = val('offensiveSlow' + k + 'DurationMin');
      chance = val('offensiveSlow' + k + 'Chance');
      L.push(renderJoin([chanceOf(chance), amount(min, max),
                         ['DamageDuration' + k], overTime(dur)]),
             '', val('offensiveSlow' + k + 'Global'));
    }

    // -- timed debuffs ------------------------------------------------------
    for (i = 0; i < DOT_DEBUFF.length; i++) {
      k = DOT_DEBUFF[i];
      min = val('offensiveSlow' + k + 'Min');
      if (!min) continue;
      dur = val('offensiveSlow' + k + 'DurationMin');
      L.push(renderJoin([fixed(min, 0), ['DamageDuration' + k], forTime(dur)]));
    }

    // -- reductions ---------------------------------------------------------
    for (i = 0; i < REDUCTIONS.length; i++) {
      k = REDUCTIONS[i][0];
      min = val('offensive' + k + 'Min');
      if (!min) continue;
      dur = val('offensive' + k + 'DurationMin');
      L.push(renderJoin([fixed(min, 0), [REDUCTIONS[i][1]], forTime(dur)]));
    }

    // -- crowd control ------------------------------------------------------
    for (i = 0; i < CONTROL.length; i++) {
      k = CONTROL[i];
      min = val('offensive' + k + 'Min');
      if (!min) continue;
      max = val('offensive' + k + 'Max');
      chance = val('offensive' + k + 'Chance');
      // the duration goes in as plain text, so the surrounding template colours it
      var span = (max && max > min)
        ? renderRaw(tpl('DamageFixedRangeFormatTime') || '', [min, max])
        : renderJoin([forTime(min)]);
      L.push(renderJoin([chanceOf(chance), ['Damage' + k, [stripTags(span)]]]),
             '', val('offensive' + k + 'Global'));
    }
    if (on('offensiveTauntMin')) L.tag('DamageTaunt', []);

    // -- percent modifiers --------------------------------------------------
    if (on('offensiveTotalDamageModifier')) L.tag('tagDamageModifierTotalDamage', [val('offensiveTotalDamageModifier')]);
    if (on('offensiveDamageMultModifier')) L.tag('tagDamageModifierDamageMult', [val('offensiveDamageMultModifier')]);
    if (on('offensiveCritDamageModifier')) L.tag('tagDamageModifierCritDamage', [val('offensiveCritDamageModifier')]);
    for (i = 0; i < DAMAGE_MODIFIERS.length; i++) {
      k = DAMAGE_MODIFIERS[i];
      if (!on('offensive' + k + 'Modifier')) continue;
      L.push(renderJoin([chanceOf(val('offensive' + k + 'ModifierChance')),
                         ['DamageModifier' + k, [val('offensive' + k + 'Modifier')]]]));
    }
    for (i = 0; i < DOT_MODIFIERS.length; i++) {
      k = DOT_MODIFIERS[i];
      if (!on('offensiveSlow' + k + 'Modifier')) continue;
      L.tag('DamageDurationModifier' + k, [val('offensiveSlow' + k + 'Modifier')]);
    }
    // "+50% Increased Burn Duration" and friends
    for (i = 0; i < DOT_DAMAGE.length; i++) {
      k = DOT_DAMAGE[i];
      if (!on('offensiveSlow' + k + 'DurationModifier')) continue;
      var dotName = tpl('tagDot' + (k === 'Life' ? 'Vitality' : k));
      L.tag('IncreasedDuration', [val('offensiveSlow' + k + 'DurationModifier'),
                                  dotName ? ' ' + stripCodes(dotName) : '']);
    }

    // -- retaliation --------------------------------------------------------
    for (i = 0; i < RETALIATION.length; i++) {
      k = RETALIATION[i];
      min = val('retaliation' + k + 'Min');
      if (!min) continue;
      max = val('retaliation' + k + 'Max');
      L.tag('Retaliation' + k, [amount(min, max)]);
    }
    // retaliation damage over time, e.g. Energy Leech Retaliation
    for (i = 0; i < DOT_DAMAGE.length; i++) {
      k = DOT_DAMAGE[i];
      min = val('retaliationSlow' + k + 'Min');
      if (!min) continue;
      dur = val('retaliationSlow' + k + 'DurationMin');
      L.push(renderJoin([chanceOf(val('retaliationSlow' + k + 'Chance')),
                         amount(min, val('retaliationSlow' + k + 'Max')),
                         ['RetaliationDuration' + k], overTime(dur)]));
    }
    for (i = 0; i < RETALIATION.length; i++) {
      k = RETALIATION[i];
      if (!on('retaliation' + k + 'Modifier')) continue;
      L.tag('RetaliationModifier' + k, [val('retaliation' + k + 'Modifier')]);
    }
    if (on('retaliationTotalDamageModifier')) L.tag('tagRetaliationModifierTotalDamage', [val('retaliationTotalDamageModifier')]);
    if (on('retaliationDamageMultModifier')) L.tag('tagRetaliationModifierDamageMult', [val('retaliationDamageMultModifier')]);
    if (on('retaliationDamagePct')) L.push(renderRaw(LITERAL.retaliationDamagePct, [val('retaliationDamagePct')]));

    // -- racial bonuses -----------------------------------------------------
    if (st.racialBonusRace) {
      var races = String(st.racialBonusRace).split(';').filter(Boolean).map(function (r) {
        var t = tpl('tag' + r + 'P') || tpl('tag' + r);
        return t ? stripCodes(t) : r;
      }).join(', ');
      if (on('racialBonusPercentDamage')) L.tag('RacialBonusPercentDamage', [val('racialBonusPercentDamage'), races]);
      if (on('racialBonusPercentDefense')) L.tag('RacialBonusPercentDefense', [val('racialBonusPercentDefense'), races]);
    }

    // -- character ----------------------------------------------------------
    for (i = 0; i < CHARACTER.length; i++) {
      if (!on(CHARACTER[i][0])) continue;
      L.tag(CHARACTER[i][1], [val(CHARACTER[i][0])]);
    }

    // -- defensive ----------------------------------------------------------
    for (i = 0; i < DEFENSIVE.length; i++) {
      if (!on(DEFENSIVE[i][0])) continue;
      L.tag(DEFENSIVE[i][1], [val(DEFENSIVE[i][0])]);
    }
    if (on('defensiveTotalSpeedResistance')) {
      L.push(renderRaw(LITERAL.defensiveTotalSpeedResistance, [val('defensiveTotalSpeedResistance')]));
    }

    // -- conversions --------------------------------------------------------
    // With no output type the conversion is really a removal - Tremor strips
    // stun duration rather than turning it into something else.
    conversion(st.conversionInType, st.conversionOutType, 'conversionPercentage');
    conversion(st.conversionInType2, st.conversionOutType2, 'conversionPercentage2');

    function conversion(inType, outType, pctKey) {
      if (!inType || !has(st, pctKey, rank)) return;
      if (outType) L.tag('tagDamageConversion', [val(pctKey), conversionName(inType), conversionName(outType)]);
      else L.tag('tagDamageRemoval', [val(pctKey), conversionName(inType)]);
    }

    // Several effects can share a single roll: "25% Chance of: ..." with the
    // effects listed underneath. XOR means only one of them lands.
    var globalChance = val('offensiveGlobalChance');
    if (globalChance) {
      var first = -1;
      for (i = 0; i < L.list.length; i++) { if (L.list[i].global) { first = i; break; } }
      if (first >= 0) {
        var xor = false;
        for (k in st) { if (/XOR$/.test(k) && at(st, k, rank)) { xor = true; break; } }
        for (i = first; i < L.list.length; i++) {
          if (L.list[i].global) L.list[i].cls = (L.list[i].cls + ' indent').trim();
        }
        L.list.splice(first, 0, {
          html: render(xor ? 'GlobalPercentChanceOfOneTag' : 'GlobalPercentChanceOfAllTag', [globalChance]),
          cls: '', global: false
        });
      }
    }

    return L.list;
  }

  // -- pets -----------------------------------------------------------------

  /* Pet health and energy are stored as equations over the owner's character
     level, e.g. "((charLevel*17.3)^1.29)+35". Small recursive descent parser:
     numbers, charLevel, + - * / ^, parentheses, unary minus. */
  function evalEquation(src, charLevel) {
    if (src === undefined || src === null) return null;
    var s = String(src), i = 0;

    function ws() { while (i < s.length && s.charAt(i) === ' ') i++; }
    function expr() {
      var v = term();
      for (ws(); i < s.length; ws()) {
        var c = s.charAt(i);
        if (c === '+') { i++; v += term(); }
        else if (c === '-') { i++; v -= term(); }
        else break;
      }
      return v;
    }
    function term() {
      var v = power();
      for (ws(); i < s.length; ws()) {
        var c = s.charAt(i);
        if (c === '*') { i++; v *= power(); }
        else if (c === '/') { i++; v /= power(); }
        else break;
      }
      return v;
    }
    function power() {
      var v = unary();
      ws();
      if (s.charAt(i) === '^') { i++; v = Math.pow(v, power()); }
      return v;
    }
    function unary() {
      ws();
      if (s.charAt(i) === '-') { i++; return -unary(); }
      return atom();
    }
    function atom() {
      ws();
      if (s.charAt(i) === '(') {
        i++;
        var v = expr();
        ws();
        if (s.charAt(i) === ')') i++;
        return v;
      }
      var m = /^[0-9]*\.?[0-9]+/.exec(s.slice(i));
      if (m) { i += m[0].length; return parseFloat(m[0]); }
      m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(s.slice(i));
      if (m) {
        i += m[0].length;
        return m[0] === 'charLevel' ? charLevel : 0;
      }
      i++;                       // skip anything unexpected rather than hang
      return 0;
    }

    var out = expr();
    return isFinite(out) ? out : null;
  }

  /* Abilities a transformation puts on your bar while it is active. Same shape
     as a pet's ability list: [{name, icon, lines}]. */
  function grantedSkills(skill, rank) {
    return arr(skill.granted).map(function (g) {
      return { name: g.name, icon: g.icon, lines: skillLines({ stats: g.stats }, rank) };
    });
  }

  /* Stats an aura hands to every pet you own, rather than to you. Stored on a
     separate petbonus record, and headed "Bonus to All Pets" in game. */
  function petBonusLines(skill, rank) {
    if (!skill.petBonus) return [];
    return skillLines({ stats: skill.petBonus }, rank);
  }

  /* One "<Pet> Attributes / Abilities" block per spawn pool.
     Returns [{ name, attrs: [line], abilities: [{name, icon, lines}] }]. */
  function petBlocks(skill, rank, charLevel) {
    var pools = arr(skill.pets);
    var out = [];
    pools.forEach(function (pet) {
      var weights = arr(pet.weights);
      var w = weights.length ? weights[Math.min(rank, weights.length) - 1] : null;
      if (pools.length > 1 && !w) return;          // this variant cannot roll yet
      var block = petBlock(pet, rank, charLevel);
      // Raise Skeletons' four variants share one name, so each block is headed
      // by the chance of rolling it. Repeating the sections underneath reads
      // more easily than hoisting out whatever the variants happen to share.
      if (pools.length > 1 && w) block.chance = Math.round(w);
      out.push(block);
    });
    return out;
  }

  function petBlock(pet, rank, charLevel) {
    var petLevel = pet.levelExpr ? evalEquation(pet.levelExpr, charLevel) : charLevel;
    petLevel = Math.max(1, Math.round(petLevel));

    var attrs = [];
    var life = evalEquation(pet.life, petLevel);
    var mana = evalEquation(pet.mana, petLevel);
    if (life) attrs.push({ html: render('SkillPetDescriptionHealth', [life]), cls: '' });
    if (mana) attrs.push({ html: render('SkillPetDescriptionMana', [mana]), cls: '' });

    var abilities = [];
    arr(pet.skills).forEach(function (ps) {
      var levels = arr(ps.levels);
      var lvl = ps.levelExpr
        ? Math.round(evalEquation(ps.levelExpr, petLevel))
        : (levels.length ? levels[Math.min(rank, levels.length) - 1] : 0);
      if (!lvl || lvl < 1) return;

      // A named ability always shows its numbers. isPetDisplayable only decides
      // whether an unnamed record folds into the attribute block - the game uses
      // it to keep its own tooltip short, which a database has no reason to do.
      if (ps.name) {
        abilities.push({ name: ps.name, icon: ps.icon, lines: skillLines({ stats: ps.stats }, lvl) });
      } else if (ps.show) {
        attrs = attrs.concat(skillLines({ stats: ps.stats }, lvl));
      }
    });

    return { name: pet.name, attrs: attrs, abilities: abilities };
  }

  function conversionName(type) {
    if (!type) return '';
    var t = tpl('tagConversion' + type);
    return t ? stripCodes(t) : type;
  }

  function stripCodes(t) {
    if (!t) return '';
    return t.replace(/\{\^[^}]*\}/g, '').replace(/[{}]/g, '').trim();
  }

  function stripTags(html) {
    return html.replace(/<[^>]*>/g, '');
  }

  /* Skill descriptions use bare caret codes (^o) as well as braced ones. */
  function renderDesc(text) {
    if (!text) return '';
    var html = '';
    var color = null;
    var re = /\{\^([^}]{1,4})\}|\^([A-Za-z-])/g;
    var last = 0, m;
    function emit(s) {
      if (!s) return;
      html += color ? '<span class="' + color + '">' + esc(s) + '</span>' : esc(s);
    }
    while ((m = re.exec(text)) !== null) {
      emit(text.slice(last, m.index));
      last = re.lastIndex;
      var code = m[1] !== undefined ? m[1] : m[2];
      if (code === 'n') { html += '<br>'; continue; }
      color = COLORS[code] || null;
    }
    emit(text.slice(last));
    return html;
  }

  return {
    skillLines: skillLines,
    petBlocks: petBlocks,
    petBonusLines: petBonusLines,
    grantedSkills: grantedSkills,
    evalEquation: evalEquation,
    render: render,
    renderRaw: renderRaw,
    renderDesc: renderDesc,
    stripCodes: stripCodes,
    stripTags: stripTags,
    at: at,
    arr: arr,
    esc: esc,
    hasTemplate: function (key) { return tpl(key) !== null; },
    setTrace: function (t) { trace = t; }
  };
})();
