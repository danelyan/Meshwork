import { z } from 'zod';

export const gridSettingsSchema = z.object({
  step: z.number().min(16).max(80),
  relief: z.number().min(0.3).max(1.6),
  angle: z.number().min(0).max(0.9),
});

export type GridSettings = z.infer<typeof gridSettingsSchema>;
export const DEFAULT_GRID_SETTINGS: GridSettings = { step: 46, relief: 1, angle: 0.5 };
export const GRID_PREVIEW_SOURCE = '/design/consultant-grid/index.html';
