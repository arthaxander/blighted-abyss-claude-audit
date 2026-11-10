import React, { useRef } from 'react';
import { GUILD_HALL_SERVICES } from './guildNavigation';
import { useGuildHallParallax } from './useGuildHallParallax';

const GuildHall = ({ onOpenService, onStartRun }) => {
  const backgroundRef = useRef(null);
  useGuildHallParallax(backgroundRef);
  return <section className="guild-hall" aria-label="Зал гильдии">
    <div ref={backgroundRef} className="guild-hall__background" data-testid="guild-hall-background" aria-hidden="true" />
    <div className="guild-hall__services" aria-label="Службы гильдии">
      {GUILD_HALL_SERVICES.map(service => <button type="button" key={service.id} className={`guild-service guild-service--${service.side}`} aria-label={service.label} title={service.label} onClick={() => onOpenService(service.id)}><span aria-hidden="true">{service.icon}</span><strong>{service.label}</strong></button>)}
    </div>
    <button type="button" className="guild-hall__field-loadout" onClick={() => onOpenService('fieldLoadout')}><span aria-hidden="true">▤</span> Настроить полевой набор</button>
    <button type="button" className="guild-hall__start" onClick={onStartRun}>НАЧАТЬ ПОХОД</button>
  </section>;
};

export default GuildHall;
