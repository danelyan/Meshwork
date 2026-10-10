import { request } from './api';

export type FavoriteKind = 'vacancy' | 'candidate';
export interface FavoritesResult { kind: FavoriteKind; ids: string[] }
export const getFavorites = () => request<FavoritesResult>('/api/favorites');
export const setFavorite = (kind: FavoriteKind, targetId: string, saved: boolean) => request<FavoritesResult>('/api/favorites', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, targetId, saved }) });
