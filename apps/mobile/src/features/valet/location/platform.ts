import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { newIntent } from '@/lib/api';

import { setAvailability } from '../api/valet';

import { valetLocationQueue } from './store';
import { VALET_LOCATION_TASK } from './task';
import type { TrackingDeps } from './tracking';

/**
 * The real OS wiring behind `startTracking` / `stopTracking`.
 *
 * `supported` is false on web, where `expo-location` refuses background
 * permission outright and no stubbing moves it (`learnings.md`). That makes the
 * browser preview report `unsupported_platform` and render the genuine offline
 * state — deliberately NOT a fake green "tracking" bar, which would defeat the
 * one thing §12.5 exists to guarantee.
 */
export const trackingDeps: TrackingDeps = {
  supported: Platform.OS !== 'web',

  async requestForeground() {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    return { granted };
  },

  async requestBackground() {
    const { granted } = await Location.requestBackgroundPermissionsAsync();
    return { granted };
  },

  async isTaskRegistered() {
    return TaskManager.isTaskRegisteredAsync(VALET_LOCATION_TASK);
  },

  async startUpdates(options) {
    await Location.startLocationUpdatesAsync(
      VALET_LOCATION_TASK,
      options as Location.LocationTaskOptions,
    );
  },

  async stopUpdates() {
    await Location.stopLocationUpdatesAsync(VALET_LOCATION_TASK);
  },

  async setAvailability(isOnline) {
    // Going online REQUIRES a position: `setValetAvailabilitySchema` refuses
    // `isOnline: true` without one, because a valet with no location cannot be
    // matched and would sit in the pool being silently skipped by every
    // candidate query. Going offline does not need one.
    if (!isOnline) {
      await setAvailability(false, newIntent());
      return;
    }

    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    await setAvailability(true, newIntent(), {
      lat: current.coords.latitude,
      lng: current.coords.longitude,
    });
  },

  async flushQueue() {
    await valetLocationQueue.drain();
  },
};

/** Whether the OS still holds the background grant, for the AppState reconcile. */
export async function hasBackgroundGrant(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { granted } = await Location.getBackgroundPermissionsAsync();
  return granted;
}

export async function isTrackingRegistered(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  return TaskManager.isTaskRegisteredAsync(VALET_LOCATION_TASK);
}

/** High while a job is live; Balanced while online and idle, to save battery. */
export const ACCURACY_ACTIVE = Location.Accuracy.High;
export const ACCURACY_IDLE = Location.Accuracy.Balanced;

/** Tells Android this is vehicle movement, which improves the fused fix. */
export const ACTIVITY_TYPE = Location.ActivityType.AutomotiveNavigation;
