import React from 'react';
import { GUILD_PRIMARY_SCREENS, GUILD_SERVICE_IDS } from './guildNavigation';

const GuildPrimaryNav = ({ activeScreen, onNavigate }) => (
  <nav className="guild-primary-nav" aria-label="Основные разделы гильдии">
    {GUILD_PRIMARY_SCREENS.map(screen => {
      const active = screen.id === activeScreen || (screen.id === 'hall' && (GUILD_SERVICE_IDS.has(activeScreen) || activeScreen === 'fieldLoadout'));
      return <button key={screen.id} type="button" className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} aria-label={screen.label} title={screen.label} onClick={() => onNavigate(screen.id)}><span aria-hidden="true">{screen.icon}</span><small>{screen.label}</small></button>;
    })}
  </nav>
);

export default GuildPrimaryNav;
