export const getGuildSilver = player => Math.max(0, Number(player?.guildSilver ?? player?.silver) || 0);

export const withGuildSilver = (player, value) => {
  const guildSilver = Math.max(0, Number(value) || 0);
  return { ...player, guildSilver, silver: guildSilver };
};

export const addGuildSilver = (player, amount) => withGuildSilver(player, getGuildSilver(player) + (Number(amount) || 0));
