// One application, one charge; independent resources reset by each new combat session.
export const ELEMENTAL_CHARGE_THRESHOLD = 2;
export const ELEMENTAL_CHARGE_IDS = Object.freeze({
  fire: 'elemental_charge_fire', ice: 'elemental_charge_ice', lightning: 'elemental_charge_lightning',
});
export const ELEMENTAL_CHARGE_DESCRIPTION = 'Каждое заклинание даёт 1 заряд своей стихии. На втором заряде Огонь наносит всем врагам 75% магической атаки; Лёд даёт Щит на 20% максимального здоровья на 2 хода; Молния заполняет шкалу хода на 30%. Расходуются только заряды сработавшей стихии. Морозный щит и призыв элементаля учитываются; действия элементаля и предметы — нет. Заряды сохраняются до конца боя.';
export const ELEMENTAL_CHARGE_DESCRIPTION_PARTS = [ELEMENTAL_CHARGE_DESCRIPTION.split('Щит')[0], { statusId: 'shield', text: 'Щит' }, ELEMENTAL_CHARGE_DESCRIPTION.split('Щит')[1]];

export function getElementalChargeSchool(ability, player) {
  if (!ability || ability.basic || ability.passive || ability.isSecondaryDamage) return null;
  if (ability.artId === 'elemental' || ability.name === 'Призыв элементаля') {
    const progression = player?.classProgression?.[player?.class] || player?.classProgression?.Mage || player?.classProgression;
    const talent = progression?.talentSelections?.['mage.summon_elemental'];
    return talent === 'mage.summon_elemental.ice' ? 'ice'
      : talent === 'mage.summon_elemental.lightning' ? 'lightning' : 'fire';
  }
  if (ability.artId === 'elemental_echo' || ability.name === 'Стихийное эхо') return player?._lastElementalSchool || null;
  return typeof ability.school === 'string' && ELEMENTAL_CHARGE_IDS[ability.school] ? ability.school : null;
}
