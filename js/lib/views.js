// Camera presets shared by the live views and the poster export, so a poster and the first
// frame of its 3D view line up exactly. 'view' framing is exact for the fixed orientation
// (hero, cards); interactive views keep a rotation-safe framing.
export const VIEWS = Object.freeze({
  hero: { yaw: -0.62, pitch: 0.32, margin: 1.03, fit: 'view', theme: 'light' },
  card: { yaw: -0.62, pitch: 0.32, margin: 1.05, fit: 'view', theme: 'light' },
  dialog: { yaw: -0.62, pitch: 0.32, margin: 1.06, theme: 'light' },
  story: { yaw: -0.62, pitch: 0.32, margin: 1.06, theme: 'stage' },
});

export const POSTER_SIZES = Object.freeze({ hero: 1200, card: 640 });
export const STILL_SIZE = Object.freeze({ width: 1200, height: 900 });
