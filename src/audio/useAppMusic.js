import { useEffect, useRef } from 'react';
import { MusicController } from './musicController';

export const useAppMusic = (currentScreen, currentLocation = null) => {
  const controllerRef = useRef(null);

  if (!controllerRef.current) controllerRef.current = new MusicController();

  useEffect(() => {
    return () => controllerRef.current?.destroy();
  }, []);

  useEffect(() => {
    controllerRef.current?.updateScreen(currentScreen, currentLocation);
  }, [currentScreen, currentLocation]);
  return controllerRef.current;
};
