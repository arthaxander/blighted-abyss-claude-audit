import React from 'react';
import { AVAILABLE_LOCATIONS, LEVEL_TWO_LOCATIONS, isLocationAvailable } from '../data/locations';
import './LocationSelectionScreen.css';

const LocationSelectionScreen = ({ onSelectLocation, onCancel, level = 1, cancelLabel }) => {
  const isLevelTwo = level === 2;
  const locations = isLevelTwo ? LEVEL_TWO_LOCATIONS : AVAILABLE_LOCATIONS;
  return (
    <main className="location-selection-shell">
      <div className="location-selection-shell__safe">
        <header className="location-selection-shell__header">
          <span aria-hidden="true">◇</span>
          <div><small>{isLevelTwo ? 'Уровень II' : 'Начало похода'}</small><h1>{isLevelTwo ? 'Выберите следующий путь' : 'Выберите путь вниз'}</h1></div>
        </header>
        <p className="location-selection-shell__intro">{isLevelTwo ? 'Первый уровень позади. Выберите один из трёх путей второго этажа.' : 'Выберите стартовую локацию для нового спуска. После начала похода сменить направление можно будет только вернувшись в Гильдию.'}</p>
        <section className="location-selection-shell__grid" aria-label={isLevelTwo ? 'Локации второго уровня' : 'Стартовые локации'}>
          {locations.map(location => {
            const disabled = isLevelTwo && !isLocationAvailable(location);
            return <button key={location.id} type="button" className={`location-selection-card${disabled ? ' is-locked' : ''}`} disabled={disabled} aria-disabled={disabled} onClick={() => !disabled && onSelectLocation(location.name)}>
              <strong>{location.name}</strong><p>{location.description}</p><small>{location.availabilityLabel || location.identityText}</small><span aria-hidden="true">{disabled ? '🔒' : '›'}</span>
            </button>;
          })}
        </section>
        <button type="button" className="location-selection-shell__back ui-action--secondary" onClick={onCancel}>{cancelLabel || (isLevelTwo ? 'Завершить экспедицию' : 'Вернуться в Гильдию')}</button>
      </div>
    </main>
  );
};

export default LocationSelectionScreen;
