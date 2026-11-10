import { useEffect } from 'react';
import { installGlobalUiSfx, sfxController } from './sfxController';

export const useAppSfx = () => {
  useEffect(() => {
    sfxController.preload();
    return installGlobalUiSfx();
  }, []);

  return sfxController;
};
