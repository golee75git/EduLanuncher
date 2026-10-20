import { useEffect, useState } from "react";
import {
  checkMap,
  clearFavorites,
  clearRecent,
  favoriteIds,
  isFavorite,
  noteVisit,
  recentRows,
  removeRecent,
  shelfWarning,
  subscribeShelf,
  toggleFavorite,
  type RecentRow,
} from "./manualShelf";

export interface ShelfView {
  favorites: string[];
  recent: RecentRow[];
  checks: Record<string, string[]>;
  warning: string;
  favorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  clearFavorites: () => void;
  removeRecent: (id: string) => void;
  clearRecent: () => void;
  noteVisit: (id: string) => void;
}

function readView(): ShelfView {
  return {
    favorites: favoriteIds(),
    recent: recentRows(),
    checks: checkMap(),
    warning: shelfWarning(),
    favorite: isFavorite,
    toggleFavorite,
    clearFavorites,
    removeRecent,
    clearRecent,
    noteVisit,
  };
}

export function useManualShelf(): ShelfView {
  const [view, setView] = useState(readView);
  useEffect(() => subscribeShelf(() => setView(readView())), []);
  return view;
}
