export const WORLD_WIDTH = 4520;
export const WORLD_HEIGHT = 540;
export const FINISH_X = 4280;
export const SPAWN = { x: 58, y: 370 };
export const CHECKPOINTS = [1480, 2820];
export const PLATFORMS = [
  { x: 0, y: 450, w: 610, h: 70 },
  { x: 660, y: 420, w: 350, h: 100 },
  { x: 1080, y: 452, w: 130, h: 68 },
  { x: 1250, y: 430, w: 530, h: 90 },
  { x: 1835, y: 452, w: 110, h: 68 },
  { x: 1985, y: 402, w: 480, h: 118 },
  { x: 2520, y: 445, w: 100, h: 75 },
  { x: 2675, y: 425, w: 500, h: 95 },
  { x: 3240, y: 455, w: 100, h: 65 },
  { x: 3400, y: 395, w: 480, h: 125 },
  { x: 3940, y: 440, w: 580, h: 80 },
  { x: 300, y: 352, w: 120, h: 16, type: 'floating' },
  { x: 755, y: 324, w: 100, h: 16, type: 'floating' },
  { x: 1380, y: 350, w: 115, h: 16, type: 'floating' },
  { x: 1600, y: 315, w: 105, h: 16, type: 'floating' },
  { x: 2100, y: 323, w: 105, h: 16, type: 'floating' },
  { x: 2320, y: 285, w: 90, h: 16, type: 'floating' },
  { x: 2800, y: 345, w: 100, h: 16, type: 'floating' },
  { x: 3540, y: 315, w: 110, h: 16, type: 'floating' },
  { x: 3740, y: 280, w: 100, h: 16, type: 'floating' },
];
export const SPIKES = [
  { x: 240, y: 419, w: 56, h: 31 }, { x: 500, y: 419, w: 52, h: 31 },
  { x: 720, y: 389, w: 48, h: 31 }, { x: 900, y: 389, w: 60, h: 31 },
  { x: 1310, y: 399, w: 54, h: 31 }, { x: 1510, y: 399, w: 65, h: 31 },
  { x: 1690, y: 399, w: 48, h: 31 }, { x: 2030, y: 371, w: 52, h: 31 },
  { x: 2215, y: 371, w: 70, h: 31 }, { x: 2380, y: 371, w: 47, h: 31 },
  { x: 2715, y: 394, w: 56, h: 31 }, { x: 2910, y: 394, w: 56, h: 31 },
  { x: 3085, y: 394, w: 62, h: 31 }, { x: 3450, y: 364, w: 56, h: 31 },
  { x: 3640, y: 364, w: 65, h: 31 }, { x: 3830, y: 364, w: 42, h: 31 },
  { x: 4020, y: 409, w: 62, h: 31 }, { x: 4165, y: 409, w: 50, h: 31 },
];
export const MOVING_HAZARDS = [
  { x: 440, y: 387, range: 48, speed: 1.9, phase: 0.3, w: 24, h: 24 },
  { x: 1150, y: 382, range: 42, speed: 2.3, phase: 1.7, w: 22, h: 22 },
  { x: 1760, y: 366, range: 36, speed: 2.8, phase: 0.7, w: 23, h: 23 },
  { x: 2472, y: 351, range: 42, speed: 2.2, phase: 2.1, w: 23, h: 23 },
  { x: 3170, y: 376, range: 34, speed: 2.9, phase: 1.1, w: 22, h: 22 },
  { x: 3868, y: 364, range: 36, speed: 2.7, phase: 0.4, w: 24, h: 24 },
];
