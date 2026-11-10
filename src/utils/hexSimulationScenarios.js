import { resolveSimulationCurseState } from './simulationAltars';
import { AVAILABLE_LOCATIONS, LEVEL_TWO_LOCATIONS } from '../data/locations';
import { getHexMacroTemplatesForLocation } from './expeditionMapLayout';
import { createExpeditionMapRun } from './expeditionMapRun';
import { createSeededSimulationRng } from './simulationRng';

export const HEX_SIMULATION_LOCATIONS = [
  ...AVAILABLE_LOCATIONS.map(location => ({ ...location, abyssLevel: 1, combatSupported: true })),
  ...LEVEL_TWO_LOCATIONS.filter(location =>
    ['withering_forest', 'restless_ruins', 'mines_of_decay'].includes(location.id)
  ).map(location => ({ ...location, abyssLevel: 2, combatSupported: true })),
];

export const getHexSimulationCatalog = () => HEX_SIMULATION_LOCATIONS.map(location => ({
  ...location, label: location.name,
  templates: getHexMacroTemplatesForLocation(location.name).map(template => ({ id: template.id, label: template.label || template.id })),
}));

export const previewHexSimulation = ({ location = 'goblin', templateId, seed = 1, initialCurses = {} } = {}) => {
  const definition = HEX_SIMULATION_LOCATIONS.find(entry => entry.id === location);
  if (!definition) throw new Error(`Unknown hex location: ${location}`);
  const run = createExpeditionMapRun({ locationId: definition.name, templateId: templateId || undefined,
    abyssLevel: definition.abyssLevel, curses: resolveSimulationCurseState(initialCurses, definition.abyssLevel).curses, rng: createSeededSimulationRng(seed) });
  return { location: definition, layout: run.mainLayout, altarBudget: run.state.altarBudget, sublocations: run.state.availableSublocationIds };
};
