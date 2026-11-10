/**
 * Stage-two talent catalogue. `combatReady` is enabled only when a class
 * combat PR implements the effect. IDs are persistence/API identifiers;
 * Russian names are presentation only.
 */
const READY_TALENTS = new Set([
  'defender.wounding_strike.deep_wound','defender.wounding_strike.open_wounds',
  'defender.defensive_strike.circular_defense','defender.defensive_strike.breach',
  'defender.fortitude.unbroken_will','defender.fortitude.combat_readiness',
  'defender.intimidation.steadfastness','defender.intimidation.suppression',
  'defender.shockwave.bloody_echo','defender.shockwave.heavy_wave',
  'defender.shield_throw.ricochet','defender.shield_throw.no_respite',
  'defender.ram.indestructible','defender.ram.acceleration',
  'defender.bloody_challenge.defensive_stance','defender.bloody_challenge.bloody_reckoning',
  'mage.fireball.charring_fire','mage.fireball.flash',
  'mage.ice_spear.deep_freeze','mage.ice_spear.shatter',
  'mage.blizzard.ice_front','mage.blizzard.shard_storm',
  'mage.chain_lightning.inevitable_chain','mage.chain_lightning.closed_chain',
  'mage.thunder_discharge.overload','mage.thunder_discharge.conductor',
  'mage.elemental_echo.echo_roll','mage.elemental_echo.saturated_echo',
  'mage.summon_elemental.greater_fire',
  'mage.summon_elemental.lightning',
  'mage.summon_elemental.ice',
  'mage.frost_shield.shard_armor',
  'mage.frost_shield.dense_ice',
  'archer.fire_arrow.tar_arrow',
  'archer.fire_arrow.explosive_arrow',
  'archer.barbed_arrow.designate_prey',
  'archer.barbed_arrow.binding_tip',
  'archer.finishing_shot.continue_hunt',
  'archer.finishing_shot.through_shot',
  'archer.quick_intercept.light_step',
  'archer.quick_intercept.seize_initiative',
  'archer.wolf_pit.drive_prey',
  'archer.wolf_pit.trap',
  'archer.redirect.offer_prey',
  'archer.redirect.return_shot',
  'archer.volley.wide_barrage',
  'archer.volley.suppressive_fire',
  'archer.snake_trap.long_poison',
  'archer.snake_trap.snake_tangle',
]);
const t = (id, name, description) => Object.freeze({ id, name, description, combatReady: READY_TALENTS.has(id) });
const set = (classId, abilityId, abilityName, requiredLevel, talents) => Object.freeze({ classId, abilityId, abilityName, requiredLevel, talents: Object.freeze(talents) });
const CLASS_TALENT_SETS = Object.freeze([
  set('Defender','defender.fortitude','Стойкость',8,[t('defender.fortitude.unbroken_will','Несломленная воля','Снимает один случайный снимаемый штраф; если его нет и нет эффекта [Печати защиты], даёт 1 заряд [Печати защиты].'),t('defender.fortitude.combat_readiness','Боевая готовность','В течение 2 своих ходов следующая атакующая способность расходует на 50% меньше запаса эффекта [Щит] при полном результате.')]),
  set('Defender','defender.intimidation','Устрашение',12,[t('defender.intimidation.steadfastness','Непоколебимость','Продлевает временные снимаемые усиления на 1, затем даёт [Непоколебимость] на 1 ход.'),t('defender.intimidation.suppression','Подавление','Сокращает снимаемые временные усиления врагов на 1 и накладывает [Подавление магии] на 2 хода.')]),
  set('Defender','defender.wounding_strike','Кровавый таран',4,[t('defender.wounding_strike.deep_wound','Глубокая рана','Добавляет эффекту [Кровотечение] ещё 2 заряда.'),t('defender.wounding_strike.open_wounds','Вскрытие ран','После наложения выполняет дополнительное срабатывание [Кровотечения] по общей формуле, не расходуя заряды.')]),
  set('Defender','defender.defensive_strike','Удар щитом',10,[t('defender.defensive_strike.circular_defense','Круговая оборона','[Щит] дополнительно +4% максимального здоровья за каждого уникального врага, атаковавшего с начала предыдущего собственного хода; максимум +12%.'),t('defender.defensive_strike.breach','Брешь в защите','Если на цели до атаки было [Кровотечение], успешное попадание накладывает [Ослабление защиты] (-25%) на 2 хода.')]),
  set('Defender','defender.shockwave','Ударная волна',14,[t('defender.shockwave.bloody_echo','Кровавый отзвук','Возвращает 20% фактически потраченного эффекта [Щит] за каждого поражённого врага, на котором до атаки было [Кровотечение], максимум 60%.'),t('defender.shockwave.heavy_wave','Тяжёлая волна','[Сильное замедление] вместо обычного; +25% прямого урона целям с врождённым иммунитетом к контролю.')]),
  set('Defender','defender.ram','Таран',16,[t('defender.ram.indestructible','Несокрушимый','После успешного удара даёт [Щит] 20% максимального здоровья на 3 хода.'),t('defender.ram.acceleration','Разгон','+15% прямого урона за каждую вражескую атаку по Защитнику в окне подготовки, максимум +45%.')]),
  set('Defender','defender.shield_throw','Бросок щита',17,[t('defender.shield_throw.ricochet','Рикошет','Другой случайный враг получает 50% исходного урона и половину оставшихся ходов эффекта [Кровотечение] с округлением вверх.'),t('defender.shield_throw.no_respite','Без передышки','Если на основной цели уже было [Кровотечение], перезарядка уменьшается на 1.')]),
  set('Defender','defender.bloody_challenge','Кровавый вызов',18,[t('defender.bloody_challenge.defensive_stance','Защитная стойка','На 20% снижает прямой урон врагов с эффектом [Провокация], включая урон эффекту [Щит].'),t('defender.bloody_challenge.bloody_reckoning','Кровавая расплата','В начале следующего своего хода наносит 100% атаки каждому врагу, попавшему по Защитнику в окне вызова.')]),
  set('Mage','mage.fireball','Огненный шар',4,[t('mage.fireball.charring_fire','Обугливающий огонь','Накладывает 1 заряд [Обугливание] на 3 хода; при прежних 3 зарядах продлевает [Горение] на 1.'),t('mage.fireball.flash','Вспышка','Если цель уже под [Горение], выполняет дополнительное срабатывание [Горения] без расхода длительности и распространения.')]),
  set('Mage','mage.chain_lightning','Цепная молния',16,[t('mage.chain_lightning.inevitable_chain','Неотвратимая цепь','[Шок] накладывается на всех поражённых врагов с вероятностью 100%.'),t('mage.chain_lightning.closed_chain','Замкнутая цепь','За каждую отсутствующую вторичную цель до двух наносит основной цели дополнительный удар 45% магической атаки.')]),
  set('Mage','mage.frost_shield','Морозный щит',12,[t('mage.frost_shield.dense_ice','Плотный лёд','Прямой урон запасу этого эффекта [Щит] снижен на 25%; перелёт по здоровью не снижается.'),t('mage.frost_shield.shard_armor','Осколочная броня','При ответе эффекта [Щит] атакующий получает 1 заряд [Ледяные осколки], а при его разрушении — 2 вместо 1.')]),
  set('Mage','mage.ice_spear','Ледяное копьё',14,[t('mage.ice_spear.deep_freeze','Промерзание','После удара накладывает [Сильное замедление] на 2 хода.'),t('mage.ice_spear.shatter','Раскол','Удваивает урон от заряда эффекта [Ледяные осколки], разбитого именно этим попаданием.')]),
  set('Mage','mage.blizzard','Буран',18,[t('mage.blizzard.ice_front','Ледяной фронт','Дополнительно уменьшает шкалу хода поражённых врагов на 15%.'),t('mage.blizzard.shard_storm','Осколочная буря','После урона добавляет поражённым врагам 2 заряда [Ледяные осколки].')]),
  set('Mage','mage.thunder_discharge','Грозовой разряд',17,[t('mage.thunder_discharge.overload','Перегрузка','Добавляет 1 [Заряд]; если он завершил тройку, разряд наносит 120% вместо 80% магической атаки.'),t('mage.thunder_discharge.conductor','Проводник','Накладывает [Проводимость] на 2 хода до прямого урона, не включая собственное условие усиления.')]),
  set('Mage','mage.elemental_echo','Стихийное эхо',10,[t('mage.elemental_echo.echo_roll','Раскат эха','Другим врагам наносится 50% магической атаки той же стихией без основного статуса.'),t('mage.elemental_echo.saturated_echo','Насыщенное эхо','Добавляет основной цели 2 заряда соответствующего эффекта: [Обугливание], [Ледяные осколки] или [Заряд] — по школе Эха.')]),
  set('Mage','mage.summon_elemental','Призыв элементаля',8,[t('mage.summon_elemental.greater_fire','Великий огненный элементаль','Призывает усиленного огненного элементаля: 60% здоровья, 75% магической атаки хозяина; смерть наносит 100% его Магической атаки всем.'),t('mage.summon_elemental.lightning','Молниевый элементаль','Призывает молниевого элементаля со скоростью 105%, использующего [Заряд] и [Проводимость], и передающего 30% шкалы хода при смерти.'),t('mage.summon_elemental.ice','Ледяной элементаль','Призывает ледяного элементаля с 70% здоровья, усиленной защитой, накладывающего [Ледяные осколки] и после смерти дающего хозяину [Щит].')]),
  set('Archer','archer.barbed_arrow','Зазубренная стрела',4,[t('archer.barbed_arrow.designate_prey','Наметить добычу','После удара накладывает эффект [Охотничья метка] на 2 хода.'),t('archer.barbed_arrow.binding_tip','Сковывающий наконечник','После попадания накладывает [Замедление] на 2 хода и уменьшает шкалу хода на 15%.')]),
  set('Archer','archer.fire_arrow','Огненная стрела',8,[t('archer.fire_arrow.tar_arrow','Смоляная стрела','[Замедление] на 2 хода и 1 заряд [Обугливание] на 3 хода.'),t('archer.fire_arrow.explosive_arrow','Взрывная стрела','Другие враги получают 60% атаки магическим уроном Огнём без [Горения].')]),
  set('Archer','archer.finishing_shot','Добивающий выстрел',16,[t('archer.finishing_shot.continue_hunt','Продолжение охоты','Убийство основной цели один раз заполняет шкалу хода на 30%.'),t('archer.finishing_shot.through_shot','Навылет','На 50% увеличивает только переносимый избыточный урон.')]),
  set('Archer','archer.quick_intercept','Быстрый перехват',12,[t('archer.quick_intercept.light_step','Лёгкий шаг','[Уклонение] +30 п.п. на 2 полных собственных хода, с обновлением без накопления.'),t('archer.quick_intercept.seize_initiative','Перехват инициативы','Уменьшает шкалу хода цели на 15%, либо на 25%, если до атаки была [Охотничья метка].')]),
  set('Archer','archer.wolf_pit','Волчья яма',10,[t('archer.wolf_pit.drive_prey','Загнать добычу','После срабатывания накладывает жертве эффект [Охотничья метка] на 2 хода.'),t('archer.wolf_pit.trap','Капкан','Срабатывает перед следующим действием врага; успешное [Оглушение] отменяет действие.')]),
  set('Archer','archer.redirect','Перенаправление',14,[t('archer.redirect.offer_prey','Подставить добычу','Предпочитает цель с эффектом [Охотничья метка]; перенаправленная атака может потратить [Охотничья метка] на гарантированный крит.'),t('archer.redirect.return_shot','Ответный выстрел','После вражеской атаки стреляет исходному атакующему на 100% атаки, если он жив.')]),
  set('Archer','archer.volley','Залп стрел',17,[t('archer.volley.wide_barrage','Широкий обстрел','После урона накладывает [Охотничья метка] на выбранную основную цель или случайного выжившего.'),t('archer.volley.suppressive_fire','Подавляющий огонь','Накладывает всем поражённым [Ослабление] на 2 хода.')]),
  set('Archer','archer.snake_trap','Змеиная ловушка',18,[t('archer.snake_trap.long_poison','Долгий яд','Каждый экземпляр эффекта [Отравление] действует 4 хода вместо 2.'),t('archer.snake_trap.snake_tangle','Змеиный клубок','Ловушка после первого срабатывания остаётся и срабатывает ещё после следующего вражеского действия.')]),
]);
const TALENT_SET_BY_ABILITY_ID = Object.freeze(Object.fromEntries(CLASS_TALENT_SETS.map(entry => [entry.abilityId, entry])));
const TALENT_BY_ID = Object.freeze(Object.fromEntries(CLASS_TALENT_SETS.flatMap(entry => entry.talents.map(talent => [talent.id, Object.freeze({ ...talent, classId: entry.classId, abilityId: entry.abilityId, requiredLevel: entry.requiredLevel })]))));
const getTalentSetForSkill = (classId, skillName) => CLASS_TALENT_SETS.find(entry => entry.classId === classId && entry.abilityName === skillName) || null;
const createReadyTalentFixture = () => CLASS_TALENT_SETS.map(entry => ({ ...entry, talents: entry.talents.map(talent => ({ ...talent, classId:entry.classId, abilityId:entry.abilityId, requiredLevel:entry.requiredLevel, combatReady: true })) }));

export {CLASS_TALENT_SETS,TALENT_SET_BY_ABILITY_ID,TALENT_BY_ID,getTalentSetForSkill,createReadyTalentFixture};
